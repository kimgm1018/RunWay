import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # ai/service를 import 경로에 둔다
sys.path.insert(0, str(Path(__file__).resolve().parent))          # demo_fakes를 import 경로에 둔다
