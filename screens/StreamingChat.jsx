// StreamingChat.jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Animated,
  InteractionManager,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../constants/theme';
import { mockStreamResponse } from '../middleware/MockStream';

// ─── Types ────────────────────────────────────────────────────────────────────
// message: { id: string, role: 'user' | 'assistant', text: string }

// ─── Constants ────────────────────────────────────────────────────────────────
const FLUSH_INTERVAL_MS = 32; // ~30fps state updates
const CURSOR = '▍';
const EMPTY_STREAM_PLACEHOLDER = '[No response received]';

/** Update only the streaming row — avoids mapping the full thread each tick. */
function patchMessageAtIndex (prev, index, text) {
  if (index < 0 || index >= prev.length) return prev;
  const row = prev[index];
  if (row.text === text) return prev;
  const next = prev.slice();
  next[index] = { ...row, text };
  return next;
}

// ─── StreamingChat ─────────────────────────────────────────────────────────────
export default function StreamingChat () {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState('idle'); // 'idle' | 'thinking' | 'streaming'
  /** Which assistant bubble is active — state so list rows re-render reliably. */
  const [streamingMessageId, setStreamingMessageId] = useState(null);

  const bufferRef = useRef('');
  /** Index of the assistant message in `messages` for O(1) flush patches. */
  const streamingIndexRef = useRef(null);
  const abortRef = useRef(null);
  const flushIntervalRef = useRef(null);
  const mountedRef = useRef(true);
  const flatListRef = useRef(null);

  const stopFlush = useCallback(() => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
  }, []);

  const startFlush = useCallback(() => {
    stopFlush();
    flushIntervalRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const idx = streamingIndexRef.current;
      if (idx == null) return;
      const buffered = bufferRef.current;
      setMessages((prev) => patchMessageAtIndex(prev, idx, buffered));
    }, FLUSH_INTERVAL_MS);
  }, [stopFlush]);

  const finalizeStream = useCallback(() => {
    stopFlush();

    const finalText = bufferRef.current;
    const idx = streamingIndexRef.current;
    const alive = mountedRef.current;

    if (alive && idx != null && idx >= 0) {
      setMessages((prev) => patchMessageAtIndex(prev, idx, finalText));
    }

    bufferRef.current = '';
    streamingIndexRef.current = null;

    if (alive) {
      setStreamingMessageId(null);
      setPhase('idle');
    }
  }, [stopFlush]);

  /**
   * Abort + commit buffer. Safe to call twice (e.g. user Stop then `finally`).
   */
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    finalizeStream();
  }, [finalizeStream]);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || phase !== 'idle') return;

    Keyboard.dismiss();
    setInput('');

    const userMessage = { id: uid(), role: 'user', text: prompt };
    const assistantId = uid();
    const assistantMessage = { id: assistantId, role: 'assistant', text: '' };

    setMessages((prev) => {
      const next = [...prev, userMessage, assistantMessage];
      streamingIndexRef.current = next.length - 1;
      return next;
    });
    setStreamingMessageId(assistantId);
    setPhase('thinking');

    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      });
    });

    bufferRef.current = '';
    abortRef.current = new AbortController();

    let firstChunk = true;
    try {
      const stream = mockStreamResponse(prompt, { signal: abortRef.current.signal });

      for await (const chunk of stream) {
        if (firstChunk) {
          firstChunk = false;
          setPhase('streaming');
          startFlush();
        }
        bufferRef.current += chunk;
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        bufferRef.current += '\n\n[Error: stream failed]';
      }
    } finally {
      const aborted = abortRef.current?.signal.aborted ?? false;
      if (
        firstChunk &&
        !aborted &&
        bufferRef.current.trim() === ''
      ) {
        bufferRef.current = EMPTY_STREAM_PLACEHOLDER;
      }
      finalizeStream();
    }
  }, [input, phase, startFlush, finalizeStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      stopFlush();
    };
  }, [stopFlush]);

  const renderMessage = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isStreaming={phase === 'streaming' && item.id === streamingMessageId}
        isThinking={phase === 'thinking' && item.id === streamingMessageId}
      />
    ),
    [phase, streamingMessageId]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ChatHeader />
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          extraData={{ phase, streamingMessageId }}
          contentContainerStyle={[
            styles.list,
            messages.length === 0 && styles.listContentEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          renderItem={renderMessage}
          ListEmptyComponent={<EmptyState />}
        />

        <InputBar
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={stopStreaming}
          phase={phase}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChatHeader () {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Chat</Text>
      <Text style={styles.headerSubtitle}>Streaming assistant</Text>
    </View>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────
function MessageBubble ({ message, isStreaming, isThinking }) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {!isUser && <RoleLabel />}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {isThinking ? (
          <ThinkingDots />
        ) : (
          <Text
            style={[styles.bubbleText, isUser && styles.bubbleTextUser]}
            selectable={!isStreaming}
          >
            {message.text}
            {isStreaming ? <StreamingCursor /> : null}
          </Text>
        )}
      </View>
    </View>
  );
}

function StreamingCursor () {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.2,
          duration: 480,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 480,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [opacity]);

  return (
    <Animated.Text
      style={[styles.cursor, { opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {CURSOR}
    </Animated.Text>
  );
}

// ─── ThinkingDots ──────────────────────────────────────────────────────────────
function ThinkingDots () {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const t = setInterval(() => setDotCount((d) => (d % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);

  return (
    <Text
      style={styles.thinkingText}
      accessibilityLabel="Assistant is thinking"
      accessibilityRole="text"
    >
      {'●'.repeat(dotCount)}{'○'.repeat(3 - dotCount)}
    </Text>
  );
}

// ─── RoleLabel ────────────────────────────────────────────────────────────────
function RoleLabel () {
  return (
    <View style={styles.roleLabel}>
      <Text style={styles.roleLabelText}>AI</Text>
    </View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
function EmptyState () {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap} accessibilityElementsHidden>
        <Text style={styles.emptyIcon}>✦</Text>
      </View>
      <Text style={styles.emptyStateTitle}>Start a conversation</Text>
      <Text style={styles.emptyStateText}>
        Messages stream in character by character, like a real assistant.
      </Text>
    </View>
  );
}

// ─── InputBar ─────────────────────────────────────────────────────────────────
function InputBar ({ value, onChange, onSend, onStop, phase }) {
  const isIdle = phase === 'idle';
  const isActive = phase === 'thinking' || phase === 'streaming';

  return (
    <View style={styles.inputBar}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Write a message…"
        placeholderTextColor={theme.textMuted}
        multiline
        maxLength={2000}
        editable={isIdle}
        returnKeyType="send"
        onSubmitEditing={onSend}
        blurOnSubmit
      />
      {isActive ? (
        <TouchableOpacity
          style={styles.stopBtn}
          onPress={onStop}
          activeOpacity={0.7}
          accessibilityLabel="Stop generating"
          accessibilityRole="button"
        >
          <View style={styles.stopIcon} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.sendBtn, !value.trim() && styles.sendBtnDisabled]}
          onPress={onSend}
          activeOpacity={0.7}
          disabled={!value.trim()}
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          <Text style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid () {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  flex: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.borderStrong,
    backgroundColor: theme.bgElevated,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: theme.textMuted,
  },

  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 14,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  bubbleUser: {
    backgroundColor: theme.userBubble,
    borderBottomRightRadius: 5,
    borderWidth: 1,
    borderColor: theme.userBubbleHighlight,
    ...Platform.select({
      ios: {
        shadowColor: theme.userBubble,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  bubbleAssistant: {
    backgroundColor: theme.surface,
    borderBottomLeftRadius: 5,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 5,
      },
      android: { elevation: 2 },
    }),
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.text,
    fontFamily: Platform.select({
      ios: 'System',
      android: 'sans-serif',
      default: 'sans-serif',
    }),
  },
  bubbleTextUser: {
    color: '#ffffff',
  },
  cursor: {
    color: theme.cursor,
  },

  thinkingText: {
    fontSize: 17,
    color: theme.accent,
    letterSpacing: 5,
    paddingVertical: 2,
  },

  roleLabel: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  roleLabelText: {
    fontSize: 10,
    color: theme.accent,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 48,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIcon: {
    fontSize: 22,
    color: theme.accent,
  },
  emptyStateTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.textSecondary,
    textAlign: 'center',
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 10 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.borderStrong,
    backgroundColor: theme.bgElevated,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
    color: theme.text,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 2,
      },
      android: { elevation: 1 },
    }),
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    ...Platform.select({
      ios: {
        shadowColor: theme.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 5,
      },
      android: { elevation: 3 },
    }),
  },
  sendBtnDisabled: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    ...Platform.select({
      ios: { shadowOpacity: 0, shadowRadius: 0 },
      android: { elevation: 0 },
    }),
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    marginTop: -2,
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.35)',
  },
  stopIcon: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: theme.danger,
  },
});
