import { 
  type Archive, 
  type InsertArchive,
  type ArchiveFile,
  type InsertArchiveFile,
  type DiffRun,
  type InsertDiffRun,
  type DiffItem,
  type InsertDiffItem,
  type Integration,
  type InsertIntegration,
  type FlowArtifact,
  type InsertFlowArtifact,
  type Report,
  type InsertReport,
  archives,
  archiveFiles,
  diffRuns,
  diffItems,
  integrations,
  flowArtifacts,
  reports,
} from "../shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // Archives
  createArchive(archive: InsertArchive): Promise<Archive>;
  getArchive(id: number): Promise<Archive | undefined>;
  getAllArchives(): Promise<Archive[]>;
  
  // Archive Files
  createArchiveFile(file: InsertArchiveFile): Promise<ArchiveFile>;
  createArchiveFiles(files: InsertArchiveFile[]): Promise<ArchiveFile[]>;
  getArchiveFiles(archiveId: number): Promise<ArchiveFile[]>;
  getArchiveFileByPath(archiveId: number, path: string): Promise<ArchiveFile | undefined>;
  
  // Diff Runs
  createDiffRun(diffRun: InsertDiffRun): Promise<DiffRun>;
  getDiffRun(id: number): Promise<DiffRun | undefined>;
  getAllDiffRuns(): Promise<DiffRun[]>;
  updateDiffRun(id: number, updates: Partial<DiffRun>): Promise<DiffRun | undefined>;
  
  // Diff Items
  createDiffItem(item: InsertDiffItem): Promise<DiffItem>;
  createDiffItems(items: InsertDiffItem[]): Promise<DiffItem[]>;
  getDiffItems(diffRunId: number): Promise<DiffItem[]>;
  getDiffItem(id: number): Promise<DiffItem | undefined>;
  
  // Integrations
  createIntegration(integration: InsertIntegration): Promise<Integration>;
  createIntegrations(integrations: InsertIntegration[]): Promise<Integration[]>;
  getIntegrations(archiveId: number): Promise<Integration[]>;
  
  // Flow Artifacts
  createFlowArtifact(artifact: InsertFlowArtifact): Promise<FlowArtifact>;
  createFlowArtifacts(artifacts: InsertFlowArtifact[]): Promise<FlowArtifact[]>;
  getFlowArtifacts(integrationId: number): Promise<FlowArtifact[]>;
  
  // Reports
  createReport(report: InsertReport): Promise<Report>;
  getReports(diffRunId: number): Promise<Report[]>;
  
  // Admin
  clearAllData(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Archives
  async createArchive(insertArchive: InsertArchive): Promise<Archive> {
    const [archive] = await db.insert(archives).values(insertArchive).returning();
    return archive;
  }
  
  async getArchive(id: number): Promise<Archive | undefined> {
    const [archive] = await db.select().from(archives).where(eq(archives.id, id));
    return archive;
  }
  
  async getAllArchives(): Promise<Archive[]> {
    return db.select().from(archives).orderBy(desc(archives.uploadedAt));
  }
  
  // Archive Files
  async createArchiveFile(insertFile: InsertArchiveFile): Promise<ArchiveFile> {
    const [file] = await db.insert(archiveFiles).values(insertFile).returning();
    return file;
  }
  
  async createArchiveFiles(insertFiles: InsertArchiveFile[]): Promise<ArchiveFile[]> {
    if (insertFiles.length === 0) return [];
    return db.insert(archiveFiles).values(insertFiles).returning();
  }
  
  async getArchiveFiles(archiveId: number): Promise<ArchiveFile[]> {
    return db.select().from(archiveFiles).where(eq(archiveFiles.archiveId, archiveId));
  }
  
  async getArchiveFileByPath(archiveId: number, path: string): Promise<ArchiveFile | undefined> {
    const [file] = await db.select().from(archiveFiles).where(
      and(eq(archiveFiles.archiveId, archiveId), eq(archiveFiles.path, path))
    );
    return file;
  }
  
  // Diff Runs
  async createDiffRun(insertDiffRun: InsertDiffRun): Promise<DiffRun> {
    const [diffRun] = await db.insert(diffRuns).values(insertDiffRun).returning();
    return diffRun;
  }
  
  async getDiffRun(id: number): Promise<DiffRun | undefined> {
    const [diffRun] = await db.select().from(diffRuns).where(eq(diffRuns.id, id));
    return diffRun;
  }
  
  async getAllDiffRuns(): Promise<DiffRun[]> {
    return db.select().from(diffRuns).orderBy(desc(diffRuns.createdAt));
  }
  
  async updateDiffRun(id: number, updates: Partial<DiffRun>): Promise<DiffRun | undefined> {
    const [updated] = await db
      .update(diffRuns)
      .set(updates)
      .where(eq(diffRuns.id, id))
      .returning();
    return updated;
  }
  
  // Diff Items
  async createDiffItem(insertItem: InsertDiffItem): Promise<DiffItem> {
    const [item] = await db.insert(diffItems).values(insertItem).returning();
    return item;
  }
  
  async createDiffItems(insertItems: InsertDiffItem[]): Promise<DiffItem[]> {
    if (insertItems.length === 0) return [];
    return db.insert(diffItems).values(insertItems).returning();
  }
  
  async getDiffItems(diffRunId: number): Promise<DiffItem[]> {
    return db.select().from(diffItems).where(eq(diffItems.diffRunId, diffRunId));
  }
  
  async getDiffItem(id: number): Promise<DiffItem | undefined> {
    const [item] = await db.select().from(diffItems).where(eq(diffItems.id, id));
    return item;
  }
  
  // Integrations
  async createIntegration(insertIntegration: InsertIntegration): Promise<Integration> {
    const [integration] = await db.insert(integrations).values(insertIntegration).returning();
    return integration;
  }
  
  async createIntegrations(insertIntegrations: InsertIntegration[]): Promise<Integration[]> {
    if (insertIntegrations.length === 0) return [];
    return db.insert(integrations).values(insertIntegrations).returning();
  }
  
  async getIntegrations(archiveId: number): Promise<Integration[]> {
    return db.select().from(integrations).where(eq(integrations.archiveId, archiveId));
  }
  
  // Flow Artifacts
  async createFlowArtifact(insertArtifact: InsertFlowArtifact): Promise<FlowArtifact> {
    const [artifact] = await db.insert(flowArtifacts).values(insertArtifact).returning();
    return artifact;
  }
  
  async createFlowArtifacts(insertArtifacts: InsertFlowArtifact[]): Promise<FlowArtifact[]> {
    if (insertArtifacts.length === 0) return [];
    return db.insert(flowArtifacts).values(insertArtifacts).returning();
  }
  
  async getFlowArtifacts(integrationId: number): Promise<FlowArtifact[]> {
    return db.select().from(flowArtifacts).where(eq(flowArtifacts.integrationId, integrationId));
  }
  
  // Reports
  async createReport(insertReport: InsertReport): Promise<Report> {
    const [report] = await db.insert(reports).values(insertReport).returning();
    return report;
  }
  
  async getReports(diffRunId: number): Promise<Report[]> {
    return db.select().from(reports).where(eq(reports.diffRunId, diffRunId));
  }
  
  // Admin
  async clearAllData(): Promise<void> {
    // Delete in order to respect foreign keys
    await db.delete(reports);
    await db.delete(flowArtifacts);
    await db.delete(diffItems);
    await db.delete(diffRuns);
    await db.delete(integrations);
    await db.delete(archiveFiles);
    await db.delete(archives);
  }
}

export const storage = new DatabaseStorage();
