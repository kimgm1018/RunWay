"""빌더 공통: 경로는 CLI로만 받고 원본은 읽기만 한다."""
import ctypes
import json
import os
from pathlib import Path

from runway_routing.national.store import sha256 as sha
from runway_routing.national.prep import code_key


def configure(input_dir, output_dir):
    source, root = input_dir.resolve(), output_dir.resolve()
    if root == source or root.is_relative_to(source) or source.is_relative_to(root):
        raise ValueError('입력과 출력은 서로 포함하지 않는 별도 폴더여야 합니다.')
    pbfs = list(source.glob('*highways*.osm.pbf'))
    if len(pbfs) != 1:
        raise ValueError('입력에 highways PBF가 정확히 하나 있어야 합니다.')
    return root, root / 'store', source, pbfs[0]


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def memory():
    if os.name == 'nt':
        class Counters(ctypes.Structure):
            _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [
                (n, ctypes.c_size_t) for n in ('peak', 'rss', 'qpp', 'qpc', 'qnpp', 'qnpc', 'page', 'peakpage')]
        info = Counters()
        info.cb = ctypes.sizeof(info)
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        fn = ctypes.windll.psapi.GetProcessMemoryInfo
        fn.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
        if not fn(kernel.GetCurrentProcess(), ctypes.byref(info), info.cb):
            raise OSError('GetProcessMemoryInfo failed')
        return {'peak_rss_mib': info.peak / 2**20}
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    import sys
    return {'peak_rss_mib': peak / (2**20 if sys.platform == 'darwin' else 1024)}


def wait_ram(label):
    # 대용량 변환 단계 경계에서 중단한다. 실행 중 OS peak 측정도 별도로 필요하다.
    if memory()['peak_rss_mib'] > 4096:
        raise MemoryError(f'4 GiB peak RSS exceeded: {label}; manifest not published')
