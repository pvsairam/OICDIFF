import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Archives - stores uploaded .iar files
export const archives = pgTable("archives", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  sha256: text("sha256").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  metadata: jsonb("metadata"),
});

export const insertArchiveSchema = createInsertSchema(archives).omit({ id: true, uploadedAt: true });
export type InsertArchive = z.infer<typeof insertArchiveSchema>;
export type Archive = typeof archives.$inferSelect;

// Archive Files - individual files within archives
export const archiveFiles = pgTable("archive_files", {
  id: serial("id").primaryKey(),
  archiveId: integer("archive_id").notNull().references(() => archives.id, { onDelete: 'cascade' }),
  path: text("path").notNull(),
  hash: text("hash").notNull(),
  size: integer("size").notNull(),
  content: text("content"),
});

export const insertArchiveFileSchema = createInsertSchema(archiveFiles).omit({ id: true });
export type InsertArchiveFile = z.infer<typeof insertArchiveFileSchema>;
export type ArchiveFile = typeof archiveFiles.$inferSelect;

// Diff Runs - comparison between two archives
export const diffRuns = pgTable("diff_runs", {
  id: serial("id").primaryKey(),
  leftArchiveId: integer("left_archive_id").notNull().references(() => archives.id, { onDelete: 'cascade' }),
  rightArchiveId: integer("right_archive_id").notNull().references(() => archives.id, { onDelete: 'cascade' }),
  status: text("status").notNull().default('pending'), // pending, processing, completed, failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  summary: jsonb("summary"), // { high: 5, medium: 12, low: 3, info: 8 }
});

export const insertDiffRunSchema = createInsertSchema(diffRuns).omit({ id: true, createdAt: true });
export type InsertDiffRun = z.infer<typeof insertDiffRunSchema>;
export type DiffRun = typeof diffRuns.$inferSelect;

// Diff Items - individual changes detected
export const diffItems = pgTable("diff_items", {
  id: serial("id").primaryKey(),
  diffRunId: integer("diff_run_id").notNull().references(() => diffRuns.id, { onDelete: 'cascade' }),
  entityType: text("entity_type").notNull(), // Integration, Map, Connection, Lookup, etc.
  entityName: text("entity_name").notNull(),
  changeType: text("change_type").notNull(), // Added, Removed, Modified, Unchanged
  severity: text("severity").notNull(), // High, Medium, Low, Info
  riskReason: text("risk_reason"),
  leftRef: text("left_ref"),
  rightRef: text("right_ref"),
  diffPatch: text("diff_patch"),
  metadata: jsonb("metadata"),
});

export const insertDiffItemSchema = createInsertSchema(diffItems).omit({ id: true });
export type InsertDiffItem = z.infer<typeof insertDiffItemSchema>;
export type DiffItem = typeof diffItems.$inferSelect;

// Integrations - integrations found in archives
export const integrations = pgTable("integrations", {
  id: serial("id").primaryKey(),
  archiveId: integer("archive_id").notNull().references(() => archives.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  identifier: text("identifier").notNull(),
  version: text("version"),
  type: text("type"), // orchestration, mapping, etc.
  metadata: jsonb("metadata"),
});

export const insertIntegrationSchema = createInsertSchema(integrations).omit({ id: true });
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrations.$inferSelect;

// Flow Artifacts - flow nodes/steps in orchestrations
export const flowArtifacts = pgTable("flow_artifacts", {
  id: serial("id").primaryKey(),
  integrationId: integer("integration_id").notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(), // trigger, invoke, assign, map, switch, etc.
  nodeName: text("node_name"),
  position: jsonb("position"), // { x: 100, y: 200 }
  config: jsonb("config"),
});

export const insertFlowArtifactSchema = createInsertSchema(flowArtifacts).omit({ id: true });
export type InsertFlowArtifact = z.infer<typeof insertFlowArtifactSchema>;
export type FlowArtifact = typeof flowArtifacts.$inferSelect;

// Reports - generated export reports
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  diffRunId: integer("diff_run_id").notNull().references(() => diffRuns.id, { onDelete: 'cascade' }),
  format: text("format").notNull(), // html, pdf
  filePath: text("file_path").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reports).omit({ id: true, generatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;

// Relations
export const archivesRelations = relations(archives, ({ many }) => ({
  files: many(archiveFiles),
  integrations: many(integrations),
  leftDiffRuns: many(diffRuns, { relationName: "leftArchive" }),
  rightDiffRuns: many(diffRuns, { relationName: "rightArchive" }),
}));

export const archiveFilesRelations = relations(archiveFiles, ({ one }) => ({
  archive: one(archives, {
    fields: [archiveFiles.archiveId],
    references: [archives.id],
  }),
}));

export const diffRunsRelations = relations(diffRuns, ({ one, many }) => ({
  leftArchive: one(archives, {
    fields: [diffRuns.leftArchiveId],
    references: [archives.id],
    relationName: "leftArchive",
  }),
  rightArchive: one(archives, {
    fields: [diffRuns.rightArchiveId],
    references: [archives.id],
    relationName: "rightArchive",
  }),
  items: many(diffItems),
  reports: many(reports),
}));

export const diffItemsRelations = relations(diffItems, ({ one }) => ({
  diffRun: one(diffRuns, {
    fields: [diffItems.diffRunId],
    references: [diffRuns.id],
  }),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  archive: one(archives, {
    fields: [integrations.archiveId],
    references: [archives.id],
  }),
  flowArtifacts: many(flowArtifacts),
}));

export const flowArtifactsRelations = relations(flowArtifacts, ({ one }) => ({
  integration: one(integrations, {
    fields: [flowArtifacts.integrationId],
    references: [integrations.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  diffRun: one(diffRuns, {
    fields: [reports.diffRunId],
    references: [diffRuns.id],
  }),
}));
