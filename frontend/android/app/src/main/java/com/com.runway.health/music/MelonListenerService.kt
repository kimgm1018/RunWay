package com.runway.health.music

import android.service.notification.NotificationListenerService

/**
 * 알림 접근 권한을 받기 위한 빈 서비스(S15P31E105-398, MUS-002). 사용자가 허용하면 활성 멜론 재생 세션을 찾을 수
 * 있다. 알림 내용은 읽거나 저장하지 않는다.
 */
class MelonListenerService : NotificationListenerService()
