"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import styles from "./home-tabs.module.css";

interface HomeTab {
  readonly key: string;
  readonly label: string;
  readonly caption: string;
  readonly content: ReactNode;
}

/**
 * One module, several views: a tab strip over panels that stay mounted, so
 * switching back is instant and each panel keeps its own polling and state.
 */
export function HomeTabs({ tabs, label }: { readonly tabs: HomeTab[]; readonly label: string }) {
  const baseId = useId();
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: selected + 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  }

  return (
    <section className={styles.module} aria-label={label}>
      <div className={styles.strip}>
        <div role="tablist" aria-label={label} className={styles.tabs} onKeyDown={onKeyDown}>
          {tabs.map((tab, index) => (
            <button
              key={tab.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={index === selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={index === selected ? 0 : -1}
              className={styles.tab}
              onClick={() => setSelected(index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className={styles.caption}>{tabs[selected]?.caption}</p>
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${baseId}-panel-${tab.key}`}
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          className={styles.panel}
          hidden={index !== selected}
        >
          {tab.content}
        </div>
      ))}
    </section>
  );
}
