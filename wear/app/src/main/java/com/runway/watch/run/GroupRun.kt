package com.runway.watch.run

/**
 * GRP-007 state of the whole group, kept apart from the runner's own [RunState]: the group can run
 * on after this runner ends, and a runner who was not ready never starts with it.
 */
enum class GroupPhase {
    /** Waiting for the group leader to start (G09). */
    WAITING,
    RUNNING,
    /** Everyone who actually started has ended. */
    FINISHED,
    /** The leader ended the whole group (G12). Never means the goal was completed. */
    FORCE_FINISHED,
}

/**
 * This runner's entry of G10 `participants` (proposal). Ranking and gaps are computed by the
 * server (GRP-008); the watch never derives or fills them in. Null means not delivered.
 */
data class GroupStanding(
    val rank: Int? = null,
    val aheadCount: Int? = null,
    val behindCount: Int? = null,
    val gapToAheadMeters: Double? = null,
    val gapToBehindMeters: Double? = null,
)

sealed interface GroupPosition {
    /** No standing has arrived yet. */
    data object Waiting : GroupPosition
    /** The server cannot rank this runner now (e.g. no course progress); the run goes on. */
    data object Unavailable : GroupPosition
    /** [delayed]: the last standing received, late; it is marked and never shown as current. */
    data class Known(val standing: GroupStanding, val delayed: Boolean = false) : GroupPosition
}

/**
 * GRP-006 notices; the watch only shows them in the run pages. A shared pace change comes as
 * GROUP_STATUS.paceChanged, the change the phone saw between two G10 reads (S15P31E105-604).
 */
sealed interface GroupNotice {
    data class PaceChanged(val fromSecondsPerKm: Int, val toSecondsPerKm: Int) : GroupNotice
}

data class GroupStatus(
    val phase: GroupPhase = GroupPhase.WAITING,
    /** G10 `groupGuidePaceSecPerKm`: the shared guide pace computed by the server (GRP-004). */
    val guidePaceSecondsPerKm: Int? = null,
    val position: GroupPosition = GroupPosition.Waiting,
    /**
     * Distance from the first to the last runner (wireframe 9.8 선두–후미), one value for the whole
     * group. Requested as a G10 field (S15P31E105-261); not in the G10 proposal yet.
     */
    val leaderToLastGapMeters: Double? = null,
    val notice: GroupNotice? = null,
    /**
     * GROUP_STATUS.rankedCount: how many runners G10 ranked now (S15P31E105-420). Runners at the same distance share a
     * rank and count neither ahead nor behind, so the total cannot come from those counts alone.
     */
    val rankedCount: Int? = null,
)
