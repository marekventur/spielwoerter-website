import { useState, useEffect } from "react";

export type ChangesetEntry = {
  original: { base: string | null; description: string | null };
  pending: { base?: string; description?: string } | null; // null = marked for deletion
};

export type Changeset = Map<string, ChangesetEntry>;

const STORAGE_KEY = "power-edit-changeset-v1";

function serialize(map: Changeset): string {
  return JSON.stringify(Array.from(map.entries()));
}

function deserialize(s: string): Changeset {
  try {
    const entries = JSON.parse(s) as [string, ChangesetEntry][];
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function readFromStorage(): Changeset {
  if (typeof window === "undefined") return new Map();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? deserialize(stored) : new Map();
  } catch {
    return new Map();
  }
}

const LIMIT_USER = 100;
const LIMIT_MODERATOR = 500;

type UseLocalStorageChangesetResult = {
  changeset: Changeset;
  setChangeset: (updater: (prev: Changeset) => Changeset) => void;
  clearChangeset: () => void;
  limit: number;
  limitReached: boolean;
};

export function useLocalStorageChangeset(isModerator: boolean): UseLocalStorageChangesetResult {
  const [changeset, setChangeset] = useState<Changeset>(readFromStorage);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(changeset));
    } catch {
      // localStorage unavailable (private mode, storage full, etc.)
    }
  }, [changeset]);

  const clearChangeset = () => setChangeset(new Map());
  const limit = isModerator ? LIMIT_MODERATOR : LIMIT_USER;
  const limitReached = changeset.size >= limit;

  return { changeset, setChangeset, clearChangeset, limit, limitReached };
}
