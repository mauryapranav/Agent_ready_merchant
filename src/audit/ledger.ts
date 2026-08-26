import { chainHash } from "../core/hash.js";

export interface AuditEntry<T = unknown> {
  seq: number;
  at: string;
  side: "buyer" | "merchant";
  kind: string;
  event: T;
  hash: string;
}

export class AuditLedger {
  private entries: AuditEntry[] = [];
  private lastHash: string | null = null;

  constructor(private readonly side: "buyer" | "merchant") {}

  append(kind: string, event: unknown, at: Date): AuditEntry {
    const entry = {
      seq: this.entries.length,
      at: at.toISOString(),
      side: this.side,
      kind,
      event,
    };
    const hash = chainHash(this.lastHash, entry);
    this.lastHash = hash;
    this.entries.push({ ...entry, hash });
    return this.entries[this.entries.length - 1]!;
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }

  verify(): boolean {
    let prev: string | null = null;
    for (const { hash, seq, at, side, kind, event } of this.entries) {
      const expected = chainHash(prev, { seq, at, side, kind, event });
      if (expected !== hash) {
        return false;
      }
      prev = hash;
    }
    return true;
  }

  get tip(): string | null {
    return this.lastHash;
  }
}
