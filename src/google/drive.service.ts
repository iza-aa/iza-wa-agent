import { google } from "googleapis";
import { Readable } from "stream";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { compressReceiptImage } from "../utils/image-optimizer.js";
import { getSupabaseClient } from "../db/supabase.js";

export class GoogleDriveService {
  private driveClient: any;
  private bucketInitialized = false;

  constructor() {
    const auth = new google.auth.JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    this.driveClient = google.drive({ version: "v3", auth });
  }

  async ensureSupabaseBucket(): Promise<void> {
    if (this.bucketInitialized) return;
    try {
      const supabase = getSupabaseClient();
      const { data: buckets } = await supabase.storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === "receipt" || b.name === "receipts");

      if (!exists) {
        logger.info("Creating public storage bucket 'receipts' in Supabase...");
        await supabase.storage.createBucket("receipt", {
          public: true,
          fileSizeLimit: 10485760, // 10MB
        });
      }
      this.bucketInitialized = true;
    } catch (err) {
      logger.warn({ err }, "Could not ensure Supabase storage bucket");
    }
  }

  async uploadToSupabaseStorage(
    imageBuffer: Buffer,
    fileName: string
  ): Promise<{ fileId: string; webViewLink: string; downloadLink: string }> {
    await this.ensureSupabaseBucket();
    const supabase = getSupabaseClient();
    const bucket = "receipt";
    const filePath = "expenses/" + new Date().getFullYear() + "/" + fileName + ".webp";

    const { error } = await supabase.storage.from(bucket).upload(filePath, imageBuffer, {
      contentType: "image/webp",
      upsert: true,
    });

    if (error) {
      logger.error({ error }, "Failed to upload image to Supabase Storage");
    }

    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
    const link = publicUrlData?.publicUrl || "";
    logger.info({ link, filePath }, "Receipt uploaded to Supabase Storage");

    return {
      fileId: filePath,
      webViewLink: link,
      downloadLink: link,
    };
  }

  async getOrCreateFolder(folderName: string, parentFolderId?: string): Promise<string> {
    const parentQuery = parentFolderId ? "\"" + parentFolderId + "\" in parents and " : "";
    const query = parentQuery + "name = \"" + folderName + "\" and mimeType = \"application/vnd.google-apps.folder\" and trashed = false";

    const listRes = await this.driveClient.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      return listRes.data.files[0].id!;
    }

    const createRes = await this.driveClient.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentFolderId ? [parentFolderId] : undefined,
      },
      fields: "id",
      supportsAllDrives: true,
    });

    logger.info({ folderName, folderId: createRes.data.id }, "Created Google Drive folder");
    return createRes.data.id!;
  }

  async uploadReceipt(
    imageBuffer: Buffer,
    fileName: string,
    userName: string = "User",
    isPdf: boolean = false
  ): Promise<{ fileId: string; webViewLink: string; downloadLink: string }> {
    const bufferToUpload = isPdf ? imageBuffer : (await compressReceiptImage(imageBuffer)).buffer;
    const finalMimeType = isPdf ? "application/pdf" : "image/webp";
    const extension = isPdf ? ".pdf" : ".webp";
    const finalFileName = fileName.endsWith(extension) ? fileName : fileName + extension;

    // 1. Simultaneous upload to Supabase Storage (Cloud CDN backup)
    this.uploadToSupabaseStorage(bufferToUpload, fileName).catch((supaErr) => {
      logger.warn({ supaErr }, "Background Supabase storage upload notice");
    });

    const now = new Date();
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(now).slice(0, 4);
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(now).slice(5, 7);

    // 2. If Google Apps Script Web App URL is configured, upload directly to User's Google Drive
    if (config.GOOGLE_APPS_SCRIPT_URL && config.GOOGLE_APPS_SCRIPT_URL.startsWith("http")) {
      try {
        const payload = {
          rootFolderId: config.GOOGLE_DRIVE_FOLDER_ID,
          year,
          month,
          userName,
          fileName: finalFileName,
          mimeType: finalMimeType,
          base64Data: bufferToUpload.toString("base64"),
        };

        const scriptRes = await fetch(config.GOOGLE_APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          redirect: "follow",
        });

        const data = (await scriptRes.json()) as any;
        if (data && data.status === "success" && data.fileId) {
          logger.info(
            { fileId: data.fileId, webViewLink: data.webViewLink, userName },
            "Receipt successfully uploaded to Google Drive via Apps Script"
          );
          return {
            fileId: data.fileId,
            webViewLink: data.webViewLink,
            downloadLink: data.downloadLink || data.webViewLink,
          };
        } else {
          logger.warn({ data }, "Apps Script returned non-success response, falling back");
        }
      } catch (scriptErr: any) {
        logger.warn({ err: scriptErr.message }, "Apps Script upload failed, trying standard Drive API");
      }
    }

    // 3. Upload to Google Drive via Service Account (Standard)
    try {
      const rootFolderId = config.GOOGLE_DRIVE_FOLDER_ID;
      const yearFolderId = await this.getOrCreateFolder(year, rootFolderId);
      const monthFolderId = await this.getOrCreateFolder(month, yearFolderId);
      const targetFolderId = await this.getOrCreateFolder(userName, monthFolderId);

      const fileStream = Readable.from(bufferToUpload);

      const res = await this.driveClient.files.create({
        requestBody: {
          name: finalFileName,
          parents: [targetFolderId],
        },
        media: {
          mimeType: finalMimeType,
          body: fileStream,
        },
        fields: "id, name, webViewLink, webContentLink",
        supportsAllDrives: true,
      });

      const fileId = res.data.id!;

      try {
        await this.driveClient.permissions.create({
          fileId: fileId,
          requestBody: {
            role: "reader",
            type: "anyone",
          },
          supportsAllDrives: true,
        });
      } catch (permErr) {
        logger.warn({ permErr, fileId }, "Could not set public permission on Drive file");
      }

      const webViewLink = res.data.webViewLink || "https://drive.google.com/file/d/" + fileId + "/view";
      logger.info({ fileId, webViewLink, targetFolder: userName }, "Receipt successfully uploaded to Google Drive");

      return {
        fileId,
        webViewLink,
        downloadLink: res.data.webContentLink || "",
      };
    } catch (driveError: any) {
      logger.warn({ error: driveError.message }, "Google Drive upload failed, falling back to Supabase Storage");
      return await this.uploadToSupabaseStorage(bufferToUpload, fileName);
    }
  }

  async renameUserFolders(oldName: string, newName: string): Promise<number> {
    if (!oldName || !newName || oldName === newName) return 0;
    try {
      const query = "name = \"" + oldName + "\" and mimeType = \"application/vnd.google-apps.folder\" and trashed = false";
      const listRes = await this.driveClient.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = listRes.data.files || [];
      for (const file of files) {
        await this.driveClient.files.update({
          fileId: file.id,
          requestBody: { name: newName },
          supportsAllDrives: true,
        });
        logger.info({ fileId: file.id, oldName, newName }, "Renamed Google Drive user folder");
      }
      return files.length;
    } catch (err) {
      logger.error({ err, oldName, newName }, "Failed to auto-rename Google Drive user folders");
      return 0;
    }
  }
}

export const googleDriveService = new GoogleDriveService();
