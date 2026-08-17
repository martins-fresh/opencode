/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"

const id = "recent-sessions"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const LIST_LIMIT = 50

const sessionTime = (session: Session) => session.time.updated ?? session.time.created

const relativeLabel = (now: number, at: number) => {
  const diff = Math.max(0, now - at)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

const cleanTitle = (title: string) => {
  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : "Untitled session"
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const api = props.api
  const theme = () => api.theme.current
  const [open, setOpen] = createSignal(true)

  // A bump signal so we can re-fetch the list when sessions change.
  const [revision, setRevision] = createSignal(0)
  const refresh = () => setRevision((value) => value + 1)

  // Re-list on any event that could add/rename/reorder sessions or change activity.
  const events = [
    "session.updated",
    "session.deleted",
    "session.status",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
  ] as const
  for (const type of events) {
    onCleanup(api.event.on(type, refresh))
  }

  // Tick every minute so relative timestamps and the 7-day window stay fresh.
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(timer))

  const [sessions] = createResource(revision, async () => {
    const response = await api.client.session.list({ roots: true, limit: LIST_LIMIT })
    return (response.data ?? []) as Session[]
  })

  const recent = createMemo(() => {
    const cutoff = now() - WEEK_MS
    return (sessions() ?? [])
      .filter((session) => !session.time.archived && sessionTime(session) >= cutoff)
      .sort((a, b) => sessionTime(b) - sessionTime(a))
  })

  const working = (sessionID: string) => (api.state.session.status(sessionID)?.type ?? "idle") !== "idle"

  const dotColor = (sessionID: string, active: boolean) => {
    const status = api.state.session.status(sessionID)?.type
    if (status === "retry") return theme().warning
    if (active) return theme().success
    return theme().textMuted
  }

  const select = (sessionID: string) => api.route.navigate("session", { sessionID })

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => recent().length > 0 && setOpen((x) => !x)}>
        <Show when={recent().length > 0}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme().text}>
          <b>Recent</b>
          <Show when={!open() && recent().length > 0}>
            <span style={{ fg: theme().textMuted }}> ({recent().length})</span>
          </Show>
        </text>
      </box>
      <Show when={open()}>
        <Show when={recent().length === 0}>
          <text fg={theme().textMuted}>No sessions this week</text>
        </Show>
        <For each={recent()}>
          {(session) => {
            const active = () => working(session.id)
            const current = () => session.id === props.sessionID
            return (
              <box flexDirection="row" gap={1} onMouseDown={() => select(session.id)}>
                <text flexShrink={0} style={{ fg: dotColor(session.id, active()) }}>
                  {active() ? "◐" : "•"}
                </text>
                <text fg={current() ? theme().text : theme().textMuted} wrapMode="truncate" flexGrow={1}>
                  <Show when={current()} fallback={cleanTitle(session.title)}>
                    <b>{cleanTitle(session.title)}</b>
                  </Show>
                </text>
                <text flexShrink={0} fg={theme().textMuted}>
                  {relativeLabel(now(), sessionTime(session))}
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // LSP is order 300, todo is 400 — sit directly under the LSP block.
    order: 350,
    slots: {
      sidebar_content(_ctx, value) {
        return <View api={api} sessionID={value.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
