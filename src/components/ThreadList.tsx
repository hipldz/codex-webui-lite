import { Component, createRef, type ReactNode } from "react";

type Props = {
  view: "recent" | "archived";
  query: string;
  children: ReactNode;
};
type ScrollSnapshot = { scrollTop: number; anchor: Element | null; offset: number };

export class ThreadList extends Component<Props, {}, ScrollSnapshot | null> {
  private list = createRef<HTMLDivElement>();

  // Capture the old layout before React inserts, removes, or resizes any rows.
  getSnapshotBeforeUpdate(previous: Props): ScrollSnapshot | null {
    const list = this.list.current;
    if (!list || !list.clientHeight) return null;
    if (
      list.scrollTop <= 0 ||
      previous.view !== this.props.view ||
      previous.query !== this.props.query
    )
      return { scrollTop: 0, anchor: null, offset: 0 };

    const top = list.getBoundingClientRect().top;
    for (const row of list.children) {
      if (!row.hasAttribute("data-thread-id")) continue;
      const bounds = row.getBoundingClientRect();
      if (bounds.bottom > top)
        return { scrollTop: list.scrollTop, anchor: row, offset: bounds.top - top };
    }
    return { scrollTop: list.scrollTop, anchor: null, offset: 0 };
  }

  componentDidUpdate(_previous: Props, _state: {}, snapshot?: ScrollSnapshot | null) {
    const list = this.list.current;
    if (!list || !snapshot || !list.clientHeight) return;
    const top =
      snapshot.anchor && list.contains(snapshot.anchor)
        ? list.scrollTop +
          snapshot.anchor.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          snapshot.offset
        : snapshot.scrollTop;
    list.scrollTop = Math.max(0, Math.min(top, list.scrollHeight - list.clientHeight));
  }

  render() {
    return (
      <div className="thread-list" ref={this.list}>
        {this.props.children}
      </div>
    );
  }
}
