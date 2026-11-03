import pytest
from datetime import timedelta
from app.demo.samples import SessionSamples, Insufficient
from demo_fakes import ms, slope, T


def test_cell_mean_and_t0():
    s = SessionSamples(); s.add([ms(1, hr=150, spd=3.0, grade=0.0), ms(4, hr=152, spd=3.2, grade=0.0), ms(6, hr=154, spd=3.0, grade=0.0)])
    i = s.build_inputs(n_cells=10, course=None)
    assert i.history["hrBpm"] == [151.0, 154.0] and i.elapsed_sec == 10


def test_input_as_of_is_oldest_latest():
    s = SessionSamples(); s.add([ms(10, hr=150, spd=None, grade=0.0), ms(14, hr=None, spd=3.0, grade=0.0)])
    assert s.build_inputs(n_cells=10, course=None).input_as_of == T + timedelta(seconds=10)


def test_duplicates_merge():
    a = [ms(5, hr=150, spd=3.0, grade=0.0)]
    s = SessionSamples(); s.add(a); s.add(a)
    assert s.build_inputs(n_cells=10, course=None).history["hrBpm"] == [150.0]


def test_out_of_order_keeps_latest():
    s = SessionSamples(); s.add([ms(20, hr=150, spd=3.0, grade=0.0)]); s.add([ms(10, hr=149, spd=3.0, grade=0.0)])
    i = s.build_inputs(n_cells=10, course=None)
    assert i.input_as_of == T + timedelta(seconds=20) and i.history["hrBpm"][-1] == 150.0


def test_grade_from_course_and_distance_fallback():
    s = SessionSamples(); s.add([ms(5 * k, hr=150, spd=2.0) for k in range(1, 7)])
    i = s.build_inputs(n_cells=24, course=slope())
    assert i.grade_source == "COURSE_PROFILE" and i.history["gradePct"][-1] == pytest.approx(5.0) and i.distance_m == 60.0


def test_insufficient_cases():
    assert SessionSamples().build_inputs(n_cells=10, course=None) == Insufficient("NO_HR")
    s = SessionSamples(); s.add([ms(5, hr=150, spd=None)])
    assert s.build_inputs(n_cells=10, course=slope()) == Insufficient("NO_SPEED")
    s = SessionSamples(); s.add([ms(5, hr=150, spd=3.0)])
    assert s.build_inputs(n_cells=10, course=None) == Insufficient("NO_GRADE")
