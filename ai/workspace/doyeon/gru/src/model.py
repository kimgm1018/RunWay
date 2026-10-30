import torch
import torch.nn as nn

class HRGRU(nn.Module):
    def __init__(self, n_features, hidden=128, layers=2):
        super().__init__()
        self.gru = nn.GRU(n_features, hidden, layers, batch_first=True)
        self.head = nn.Linear(hidden, 1)

    def forward(self, x):                  # x: (batch, time, features)
        out, _ = self.gru(x)               # out: (batch, time, hidden)
        return self.head(out).squeeze(-1)  # (batch, time)

class HorizonGRU(nn.Module):
    """과거 2분 + 미래 2분(48칸)을 읽고, +30/+60/+120초의 심박 변화량 3개를 예측한다."""

    def __init__(self, n_inputs=4, hidden=64, layers=2, n_out=3, dropout = 0.0, mask_future_grade=False, fut=24):
        super().__init__()
        self.gru = nn.GRU(n_inputs, hidden, layers, batch_first=True, dropout=dropout)
        self.head = nn.Linear(hidden, n_out)
        self.mask_future_grade = mask_future_grade   # True: 미래 경사 칸을 항상 비움 (경사 모를 때용 모델)
        self.fut = fut

    def features(self, seq):             # 출력층에 들어가는 GRU 마지막 상태
        if self.mask_future_grade:
            seq = seq.clone()
            seq[:, -self.fut:, 1] = 0    # 미래 경사 = 0 (정규화 값, 모든 샘플 같은 값이라 정보 없음)
        out, _ = self.gru(seq)           # out: (batch, 칸 수, hidden)
        return out[:, -1]                # 마지막 칸까지 다 읽은 상태

    def forward(self, seq):              # seq: (batch, 과거 + 미래 칸, 입력 수)
        return self.head(self.features(seq))   # +30/+60/+120초 변화량 3개


if __name__ == "__main__":
    # 이 파일을 직접 실행했을 때만 도는 확인용 코드
    model = HRGRU(n_features=3)
    x = torch.randn(8, 60, 3)  # 배치 8개, 60스텝, 특징 3개짜리 아무 숫자
    print(model(x).shape)