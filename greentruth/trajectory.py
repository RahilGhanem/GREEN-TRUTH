"""
Trajectory analysis for forward-looking commitments.

A pledge ("we will eliminate routine flaring by 2030") cannot be true or false
today. The only honest question is whether the observations so far are on a path
toward the target, and the only honest answer carries an interval wide enough to
admit that extrapolation is extrapolation.

Three kinds of value are produced and they are never merged:

    OBSERVED   a measurement from the dataset
    PROJECTED  a model extrapolation, with an interval
    TARGET     what the organisation committed to

`schema.OBSERVED / PROJECTED` tag every point, so the interface cannot
accidentally draw a projection in the same style as a measurement.

Method, stated plainly so it can be criticised: ordinary least squares on the
annual series, extrapolated linearly to the target year, with a residual
bootstrap for the interval. A linear extrapolation of an annual series a decade
forward is a weak model, and its interval widens with distance but does not
capture structural change (policy, shutdowns, new production). It is reported as
an indication of the current path, never as a prediction of compliance.
"""

import random

from .schema import (
    OBSERVED,
    PROJECTED,
    TRAJECTORY_CONSISTENT,
    TRAJECTORY_INCONSISTENT,
    TRAJECTORY_UNCERTAIN,
)

MIN_POINTS = 5
N_BOOT = 2000
SEED = 7


def _ols(xs, ys):
    n = len(xs)
    xbar = sum(xs) / n
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    if sxx == 0:
        return ybar, 0.0
    slope = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    return ybar - slope * xbar, slope


def _percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    i = int(q * (len(sorted_vals) - 1))
    return sorted_vals[i]


def analyse(series, target_year, target_value=0.0, target_change_percent=None,
            baseline_year=None, level=0.90):
    """
    Assess progress toward a future target.

    Returns a dict with `observed`, `projected`, `required`, `target`, the
    trajectory verdict, and the reasoning behind it. Returns `feasible=False`
    with a reason when the series cannot support a projection.
    """
    years = sorted(series)
    if len(years) < MIN_POINTS:
        return dict(feasible=False,
                    reason=f"Only {len(years)} annual observations; at least "
                           f"{MIN_POINTS} are needed to estimate a trajectory.",
                    verdict=TRAJECTORY_UNCERTAIN)
    if target_year is None:
        return dict(feasible=False,
                    reason="The commitment does not state a target year.",
                    verdict=TRAJECTORY_UNCERTAIN)

    values = [float(series[y]) for y in years]
    last_year, last_value = years[-1], values[-1]

    # A relative pledge ("cut 50% by 2030 from 2019") resolves to an absolute
    # target only if the baseline year is actually observed.
    resolved_target = target_value
    target_basis = "absolute"
    if target_change_percent is not None:
        base_y = baseline_year if baseline_year in series else years[0]
        resolved_target = float(series[base_y]) * (1.0 + target_change_percent / 100.0)
        target_basis = f"{target_change_percent:+.0f}% from {base_y}"
    if resolved_target is None:
        return dict(feasible=False,
                    reason="The commitment does not state a target value.",
                    verdict=TRAJECTORY_UNCERTAIN)

    if target_year <= last_year:
        return dict(feasible=False,
                    reason=f"The target year {target_year} is not in the future "
                           f"relative to the observations (which end in {last_year}).",
                    verdict=TRAJECTORY_UNCERTAIN)

    intercept, slope = _ols(years, values)
    fitted = [intercept + slope * y for y in years]
    residuals = [v - f for v, f in zip(values, fitted)]

    # Residual bootstrap. Each resample yields ONE refitted line (b0, b1); that
    # same line is then evaluated at every horizon year, so the band describes a
    # family of coherent trajectories rather than a per-year mix of different
    # fits. Drawing the lines once also keeps the band and the value at the
    # target mutually consistent.
    rng = random.Random(SEED)
    lines = []
    for _ in range(N_BOOT):
        resampled = [f + rng.choice(residuals) for f in fitted]
        lines.append(_ols(years, resampled))

    lo_q, hi_q = (1 - level) / 2, 1 - (1 - level) / 2
    horizon = list(range(last_year + 1, target_year + 1))

    at_target = sorted(b0 + b1 * target_year for b0, b1 in lines)
    proj_lo = _percentile(at_target, lo_q)
    proj_hi = _percentile(at_target, hi_q)
    proj_point = intercept + slope * target_year

    # Per-year projected band, for the chart. Flaring volume cannot be negative,
    # so the DISPLAY is clamped at zero; the decision below uses the unclamped
    # values so clamping can never manufacture apparent compliance.
    band = []
    for y in horizon:
        vals = sorted(b0 + b1 * y for b0, b1 in lines)
        band.append(dict(year=y,
                         value=round(max(intercept + slope * y, 0.0), 6),
                         lower=round(max(_percentile(vals, lo_q), 0.0), 6),
                         upper=round(max(_percentile(vals, hi_q), 0.0), 6),
                         provenance=PROJECTED))

    tol = max(0.02 * max(values), 1e-9)

    if proj_hi <= resolved_target + tol:
        verdict = TRAJECTORY_CONSISTENT
        reasoning = (f"Extrapolating the observed {years[0]}-{last_year} trend, the "
                     f"whole {int(level*100)}% projection interval at {target_year} "
                     f"({proj_lo:.2f} to {proj_hi:.2f}) sits at or below the target "
                     f"of {resolved_target:.2f}.")
    elif proj_lo > resolved_target + tol:
        verdict = TRAJECTORY_INCONSISTENT
        reasoning = (f"Extrapolating the observed {years[0]}-{last_year} trend, the "
                     f"entire {int(level*100)}% projection interval at {target_year} "
                     f"({proj_lo:.2f} to {proj_hi:.2f}) lies above the target of "
                     f"{resolved_target:.2f}.")
    else:
        verdict = TRAJECTORY_UNCERTAIN
        reasoning = (f"The {int(level*100)}% projection interval at {target_year} "
                     f"({proj_lo:.2f} to {proj_hi:.2f}) straddles the target of "
                     f"{resolved_target:.2f}, so the observed trend cannot "
                     f"distinguish meeting it from missing it.")

    # The constant annual reduction that would be needed from the last
    # observation to hit the target exactly.
    span = target_year - last_year
    required_rate = (resolved_target - last_value) / span if span else None
    required = [dict(year=last_year, value=round(last_value, 6), provenance=OBSERVED)]
    for y in horizon:
        required.append(dict(year=y,
                             value=round(max(last_value + required_rate * (y - last_year), 0.0), 6),
                             provenance="required"))

    return dict(
        feasible=True,
        verdict=verdict,
        reasoning=reasoning,
        method=("ordinary least squares on the annual series, extrapolated to the "
                "target year; interval from a residual bootstrap "
                f"({N_BOOT} resamples, seed {SEED})"),
        method_caveat=("Linear extrapolation cannot anticipate policy changes, "
                       "shutdowns or new production. It describes the current path, "
                       "not a prediction of compliance."),
        level=level,
        observed=[dict(year=y, value=round(v, 6), provenance=OBSERVED)
                  for y, v in zip(years, values)],
        projected=band,
        required=required,
        target=dict(year=target_year, value=round(float(resolved_target), 6),
                    basis=target_basis, provenance="target"),
        projection_at_target=dict(
            year=target_year,
            value=round(proj_point, 6),
            lower=round(proj_lo, 6),
            upper=round(proj_hi, 6),
            provenance=PROJECTED),
        observed_annual_rate=round(slope, 6),
        required_annual_rate=round(required_rate, 6) if required_rate is not None else None,
        last_observed=dict(year=last_year, value=round(last_value, 6), provenance=OBSERVED),
        gap_at_target=round(proj_point - float(resolved_target), 6),
    )
