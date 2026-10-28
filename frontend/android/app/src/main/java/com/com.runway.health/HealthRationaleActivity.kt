package com.runway.health
import android.app.Activity
import android.os.Bundle
import android.widget.TextView
class HealthRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = TextView(this)
    text.text = "RunWay 건강 데이터 이용 안내\n\n수면, 심박, 안정 시 심박, HRV, 걸음, 운동, 거리를 읽어 기록과 출처를 화면에 표시합니다.\n\n쓰기 권한과 백그라운드 수집은 사용하지 않습니다. 건강 기록을 서버에 전송하거나 별도로 저장하지 않습니다.\n\n휴대폰의 Health Connect 설정에서 항목별 접근을 언제든 변경할 수 있습니다."
    text.textSize = 18f
    text.setPadding(40, 64, 40, 40)
    setContentView(text)
  }
}
