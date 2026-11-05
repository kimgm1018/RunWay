"""S15P31E105-441 R3/R4: 손상·불일치 파생 파일은 이유를 남기고 폴백하고, 실제 PBF가 없으면 그대로 실패한다.

env edge cache (data.EnvFeatureCache.load), compact network store (network_store.load + factory),
source snapshot (source_snapshot.load + factory). 실제 bundle의 파일을 임시 폴더에 복사해 망가뜨린다(원본은 읽기만).
RUNWAY_DATA_DIR(데이터 root)가 필요하다. 없으면 건너뛴다.
"""
import json
import os
import shutil
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

DATA = os.environ.get("RUNWAY_DATA_DIR")
HAVE = bool(DATA) and (Path(DATA) / "data" / "osm" / "busan").is_dir()


@unittest.skipUnless(HAVE, "RUNWAY_DATA_DIR with data/osm/busan is needed")
class EnvCacheFallback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from runway_routing import data as D
        cls.D = D
        cls.env = {"name": "wide", "path": str(D.WIDE_ENV_PATH.relative_to(D.REPORTS.parent))}
        cls.tmp = Path(tempfile.mkdtemp(prefix="envcache441_"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _copy(self, name):
        d = self.tmp / name
        d.mkdir()
        shutil.copy2(self.D.ARRAYS_PATH, d / self.D.ARRAYS_PATH.name)
        shutil.copy2(self.D.PROVENANCE_PATH, d / self.D.PROVENANCE_PATH.name)
        return d / self.D.ARRAYS_PATH.name, d / self.D.PROVENANCE_PATH.name

    def _load(self, arrays, prov):
        with mock.patch.object(self.D, "ARRAYS_PATH", arrays), mock.patch.object(self.D, "PROVENANCE_PATH", prov):
            return self.D.EnvFeatureCache.load(self.env)

    def _prov(self, path, change):
        p = json.loads(path.read_text(encoding="utf-8"))
        change(p)
        path.write_text(json.dumps(p), encoding="utf-8")

    def test_bundle_cache_is_valid(self):
        cache, why = self._load(*self._copy("ok"))
        self.assertIsNotNone(cache, why)
        self.assertEqual(why, "")

    def test_arrays_changed_after_build(self):         # R3: a readable npz with other values was accepted before
        arrays, prov = self._copy("arrays")
        with np.load(arrays, allow_pickle=False) as z:
            keys, dist = z["keys"], z["dist_dm"].copy()
        dist[0, 0] += 1
        np.savez_compressed(arrays, keys=keys, dist_dm=dist)
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("arrays file differs", why)

    def test_actual_extract_differs(self):             # R3: EXTRACT.json alone was compared before
        with mock.patch.object(self.D, "file_sha256", return_value="0" * 64):
            cache, why = self._load(*self._copy("pbf"))
        self.assertIsNone(cache)
        self.assertIn("actual sha256", why)

    def test_provenance_not_an_object(self):          # R4: AttributeError on .get before
        arrays, prov = self._copy("list")
        prov.write_text("[]", encoding="utf-8")
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("not a JSON object", why)

    def test_provenance_broken_json(self):
        arrays, prov = self._copy("json")
        prov.write_text("{", encoding="utf-8")
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("JSONDecodeError", why)

    def test_provenance_missing_key(self):             # R4: KeyError before
        arrays, prov = self._copy("key")
        self._prov(prov, lambda p: p.pop("extract"))
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("KeyError", why)

    def test_broken_npz_with_matching_record(self):    # R4: np.load raised (ValueError: not a zip -> pickle refused)
        arrays, prov = self._copy("zip")
        arrays.write_bytes(b"not a zip file")
        import hashlib
        sha = hashlib.sha256(b"not a zip file").hexdigest()
        self._prov(prov, lambda p: p.update(arrays_bytes=14, arrays_sha256=sha))
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("cache unreadable or malformed", why)

    def test_array_shape_mismatch(self):
        arrays, prov = self._copy("shape")
        self._prov(prov, lambda p: p.update(segments=p["segments"] + 1))
        cache, why = self._load(arrays, prov)
        self.assertIsNone(cache)
        self.assertIn("do not match", why)

    def test_missing_pbf_still_fails(self):
        empty = self.tmp / "no_pbf"
        empty.mkdir()
        with mock.patch.object(self.D.api.busan, "BUSAN_DIR", empty), self.assertRaises(SystemExit):
            self._load(*self._copy("nopbf"))


@unittest.skipUnless(HAVE, "RUNWAY_DATA_DIR with data/osm/busan is needed")
class StoreAndSnapshotFallback(unittest.TestCase):
    """network_store / source_snapshot: malformed manifest or files -> None + reason -> the factory falls back."""

    @classmethod
    def setUpClass(cls):
        from runway_routing import network_store as NS, source_snapshot as SS
        from runway_routing.data import api
        cls.mods = (NS, SS)
        cls.extract = api.busan._busan_pbf()
        cls.tmp = Path(tempfile.mkdtemp(prefix="store441_"))
        cls.want = {m: m.key(cls.extract) for m in cls.mods}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _dir(self, mod, name, manifest, files=None):
        d = self.tmp / f"{mod.__name__.rsplit('.', 1)[-1]}_{name}"
        d.mkdir()
        for f, data in (files or {}).items():
            (d / f).write_bytes(data)
        (d / mod.MANIFEST).write_text(manifest if isinstance(manifest, str) else json.dumps(manifest), encoding="utf-8")
        return d

    def _fallback(self, mod, d):
        """status reason + whether the factory returned the previous loader's object."""
        status = {}
        busan = types.SimpleNamespace(BusanSource=lambda path=None: "PARSED", _busan_pbf=lambda: self.extract)
        ctx = mod.source_from_store if hasattr(mod, "source_from_store") else mod.source_from_snapshot
        env = "RUNWAY_NETWORK_STORE" if hasattr(mod, "source_from_store") else "RUNWAY_SOURCE_SNAPSHOT"
        with mock.patch.dict(os.environ, {env: str(d)}), ctx(busan, status):
            got = busan.BusanSource()
        return status, got

    def test_malformed_manifests_fall_back(self):
        import hashlib
        for mod in self.mods:
            arrays, strings = mod.ARRAYS, mod.STRINGS
            junk = b"not a zip file"
            cases = {
                "list": ("[]", None),
                "key_not_object": ({"key": "x"}, None),
                # the data files exist, so the old code reached man["files"]: KeyError / AttributeError before
                "no_files": ({"key": self.want[mod]}, {arrays: junk, strings: b"[]"}),
                "files_not_object": ({"key": self.want[mod], "files": []}, {arrays: junk, strings: b"[]"}),
                "broken_npz": ({"key": self.want[mod], "files": {arrays: hashlib.sha256(junk).hexdigest(),
                                                                  strings: hashlib.sha256(b"[]").hexdigest()}},
                               {arrays: junk, strings: b"[]"}),                         # np.load raised before
            }
            for name, (man, files) in cases.items():
                with self.subTest(mod=mod.__name__, case=name):
                    status, got = self._fallback(mod, self._dir(mod, name, man, files))
                    self.assertEqual(got, "PARSED")
                    self.assertFalse(status["used"])
                    self.assertTrue(status["reason"])

    def test_missing_pbf_still_fails(self):
        for mod in self.mods:
            with self.subTest(mod=mod.__name__):
                d = self._dir(mod, "nopbf", "[]")
                status = {}

                def no_pbf():
                    raise SystemExit("expected one Busan extract, found 0")

                busan = types.SimpleNamespace(BusanSource=lambda path=None: "PARSED", _busan_pbf=no_pbf)
                ctx = mod.source_from_store if hasattr(mod, "source_from_store") else mod.source_from_snapshot
                env = "RUNWAY_NETWORK_STORE" if hasattr(mod, "source_from_store") else "RUNWAY_SOURCE_SNAPSHOT"
                with mock.patch.dict(os.environ, {env: str(d)}), ctx(busan, status), self.assertRaises(SystemExit):
                    busan.BusanSource()


if __name__ == "__main__":
    unittest.main()
