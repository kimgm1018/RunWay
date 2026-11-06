package com.runway.backend.domain.image;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class WithdrawnImageCleanupWorkerTest {
    @Test
    void failedMemberDoesNotBlockBatchAndNewWorkerStartsAgainFromZero() {
        var accounts = mock(WithdrawnImageCleanupRepository.class);
        var cleanup = mock(WithdrawnImageCleanup.class);
        when(accounts.maxWithdrawnId()).thenReturn(2L);
        when(accounts.findAfter(0, 2, 100)).thenReturn(List.of(1L, 2L));
        doThrow(new IllegalStateException("synthetic")).when(cleanup).clean(1);
        var worker = new WithdrawnImageCleanupWorker(accounts, cleanup);
        worker.retryBatch();
        verify(cleanup).clean(2);
        worker.retryBatch();
        verify(accounts, times(2)).findAfter(0, 2, 100);
        verify(cleanup, times(2)).clean(2);
        new WithdrawnImageCleanupWorker(accounts, cleanup).retryBatch();
        verify(accounts, times(3)).findAfter(0, 2, 100);
    }

    @Test
    void failedLookupKeepsCursorAndDoesNotDeleteFiles() {
        var accounts = mock(WithdrawnImageCleanupRepository.class);
        var cleanup = mock(WithdrawnImageCleanup.class);
        when(accounts.maxWithdrawnId()).thenReturn(4L);
        when(accounts.findAfter(0, 4, 100)).thenThrow(new IllegalStateException("synthetic"))
                .thenReturn(List.of(4L));
        var worker = new WithdrawnImageCleanupWorker(accounts, cleanup);
        worker.retryBatch();
        verifyNoInteractions(cleanup);
        worker.retryBatch();
        verify(cleanup).clean(4);
    }

    @Test
    void fixedUpperBoundRevisitsFailuresDespiteContinuousNewWithdrawals() {
        var accounts = mock(WithdrawnImageCleanupRepository.class);
        var cleanup = mock(WithdrawnImageCleanup.class);
        when(accounts.maxWithdrawnId()).thenReturn(200L, 400L);
        var first = java.util.stream.LongStream.rangeClosed(1, 100).boxed().toList();
        var second = java.util.stream.LongStream.rangeClosed(101, 200).boxed().toList();
        when(accounts.findAfter(0, 200, 100)).thenReturn(first);
        when(accounts.findAfter(100, 200, 100)).thenReturn(second);
        when(accounts.findAfter(0, 400, 100)).thenReturn(first);
        doThrow(new IllegalStateException("synthetic")).when(cleanup).clean(1);
        var worker = new WithdrawnImageCleanupWorker(accounts, cleanup);
        worker.retryBatch(); // New IDs may arrive above 200 after this page.
        worker.retryBatch(); // Stop at 200 instead of chasing the arrivals.
        worker.retryBatch(); // New sweep retries the failed ID 1.
        verify(accounts, times(2)).maxWithdrawnId();
        verify(cleanup, times(2)).clean(1);
        verify(cleanup).clean(200);
        verify(accounts, never()).findAfter(200, 200, 100);
    }

    @Test
    void missingLastMemberEndsSweepRatherThanKeepingAnUnreachableBoundary() {
        var accounts = mock(WithdrawnImageCleanupRepository.class);
        var cleanup = mock(WithdrawnImageCleanup.class);
        when(accounts.maxWithdrawnId()).thenReturn(5L, 6L);
        when(accounts.findAfter(0, 5, 100)).thenReturn(List.of());
        when(accounts.findAfter(0, 6, 100)).thenReturn(List.of(6L));
        var worker = new WithdrawnImageCleanupWorker(accounts, cleanup);
        worker.retryBatch();
        worker.retryBatch();
        verify(cleanup).clean(6);
    }

    @Test
    void activeMissingAndFailedDatabaseReadsNeverReachFileDeletion() {
        var accounts = mock(WithdrawnImageCleanupRepository.class);
        var files = mock(ImageStorage.class);
        var cleanup = new WithdrawnImageCleanup(accounts, files);
        assertThat(cleanup.clean(-1)).isFalse();
        assertThat(cleanup.clean(1)).isFalse();
        when(accounts.isCommittedWithdrawal(2)).thenThrow(new IllegalStateException("synthetic"));
        assertThatThrownBy(() -> cleanup.clean(2)).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(files);
        when(accounts.isCommittedWithdrawal(3)).thenReturn(true);
        assertThat(cleanup.clean(3)).isTrue();
        verify(files).deletePersonalImages(3);
    }
}
