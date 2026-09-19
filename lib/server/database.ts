import "server-only";

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/lib/server/settings";
import {
  initializeContentStore,
  listContentItems,
  upsertContentItems,
  type ContentCategory,
} from "@/lib/archive-store";
import { initializeWorkspaceStore } from "@/lib/workspace-store";
import { initializeBriefStore } from "@/lib/brief-store";
import { initializeIndustryStore } from "@/lib/industry-store";
import { initializeCollectorCache } from "@/lib/collector-cache";
import { initializeNewsletterStore } from "@/lib/newsletter-store";
import { initializeAgenticStore } from "@/lib/agentic-store";
import { initializeComputerSkillsStore } from "@/lib/server/computer-skills-store";
import { initializeStoryBriefStore } from "@/lib/server/story-brief";
import { initializeKernelStore } from "@/lib/server/kernel/kernel-store";

export { setContentArchived } from "@/lib/archive-store";
export type { ContentCategory } from "@/lib/archive-store";

declare global {
  var controlCenterDatabase: DatabaseSync | undefined;
}

export function getDatabase() {
  if (!globalThis.controlCenterDatabase) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const databasePath = path.join(directory, "control-center.sqlite");
    const databaseExisted =
      existsSync(databasePath) && statSync(databasePath).size > 0;
    const database = new DatabaseSync(databasePath);
    database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
    );
    const schema = database.prepare("PRAGMA user_version").get() as unknown as {
      user_version: number;
    };
    if (schema.user_version > 6) {
      database.close();
      throw new Error(
        `This data directory uses schema ${schema.user_version}, but this Control Center supports schema 6. Update the app before opening it.`,
      );
    }
    if (databaseExisted && schema.user_version < 6) {
      const backupDirectory = path.join(directory, "migration-backups");
      mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      const backupPath = path.join(
        backupDirectory,
        `control-center-v${schema.user_version}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.sqlite`,
      );
      database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
      chmodSync(backupPath, 0o600);
    }
    const initialized = initializeKernelStore(
      initializeStoryBriefStore(
        initializeComputerSkillsStore(
          initializeAgenticStore(
            initializeNewsletterStore(
              initializeCollectorCache(
                initializeIndustryStore(
                  initializeBriefStore(
                    initializeWorkspaceStore(initializeContentStore(database)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    if (schema.user_version < 6) initialized.exec("PRAGMA user_version = 6;");
    chmodSync(databasePath, 0o600);
    globalThis.controlCenterDatabase = initialized;
    import("@/lib/server/agentic-scheduler")
      .then((m) => m.startAutonomousScheduler())
      .catch(() => {});
  }
  return globalThis.controlCenterDatabase;
}

export function syncContentItems<
  T extends {
    id: string;
    url?: string;
    gmailUrl?: string;
    publishedAt?: string;
    receivedAt?: string;
    collectionScope?: string;
  },
>(
  category: ContentCategory,
  items: T[],
  options: {
    freshSince?: string;
    freshUntil?: string;
    currentSweepOnly?: boolean;
    activeScopes?: Iterable<string>;
  } = {},
) {
  const database = getDatabase();
  upsertContentItems(database, category, items);
  return listContentItems<T>(database, category, {
    freshSince: options.freshSince,
    freshUntil: options.freshUntil,
    activeExternalIds: options.currentSweepOnly
      ? items.map((item) => item.id)
      : undefined,
    activeUrls: options.currentSweepOnly
      ? items.flatMap((item) =>
          item.url || item.gmailUrl ? [item.url || item.gmailUrl || ""] : [],
        )
      : undefined,
    activeScopes: options.activeScopes,
  });
}
