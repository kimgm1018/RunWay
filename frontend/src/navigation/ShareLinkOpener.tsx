import React, { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { SharedRunReplay } from '../screens/community/SharedRunReplay';
import { parseShareLink, type ShareLink } from './shareLinks';
import type { RootStackParamList } from './types';

// Opens 경로 재생 links (S15P31E105-704), whether they started the app or arrived while it runs. A shared run plays
// over whatever is on screen, signed in or not. A post needs signing in: the link waits until then and opens
// 7.2 with its course replay.
export function ShareLinkOpener({
  navigation,
  signedIn,
}: {
  navigation: NavigationContainerRefWithCurrent<RootStackParamList>;
  signedIn: boolean;
}) {
  const [run, setRun] = useState<string | null>(null);
  const [post, setPost] = useState<string | null>(null);
  // The navigator mounts after the container; a post waits for it as well as for sign-in.
  const [ready, setReady] = useState(navigation.isReady());

  useEffect(() => {
    let active = true;
    const take = (link: ShareLink | null) => {
      if (!active || !link) {
        return;
      }
      if (link.kind === 'run') {
        setRun(link.token);
      } else {
        setPost(link.postId);
      }
    };
    Linking.getInitialURL().then(
      url => take(parseShareLink(url)),
      () => undefined,
    );
    const subscription = Linking.addEventListener('url', ({ url }) =>
      take(parseShareLink(url)),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (ready) {
      return;
    }
    if (navigation.isReady()) {
      setReady(true);
      return;
    }
    const unsubscribe = navigation.addListener('state', () => {
      if (navigation.isReady()) {
        setReady(true);
      }
    });
    return unsubscribe;
  }, [navigation, ready]);

  useEffect(() => {
    if (post && signedIn && ready) {
      setPost(null);
      navigation.navigate('PostDetail', { postId: post, replay: true });
    }
  }, [navigation, post, ready, signedIn]);

  const close = useCallback(() => setRun(null), []);
  return run ? <SharedRunReplay key={run} token={run} onClose={close} /> : null;
}
