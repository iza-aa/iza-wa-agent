import { describe, it, expect } from "vitest";
import { parseEnv } from "../../../src/config/env.js";

describe("Environment Config Validator", () => {
  it("should validate and parse comma-separated Gemini API keys and Super Admin Phones into arrays", () => {
    const mockEnv = {
      GEMINI_API_KEYS: "key1,key2,key3",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-service-role-key",
      SUPER_ADMIN_PHONE: "6281346367235,232130131046571",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@project.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
      GOOGLE_SHEET_ID: "sheet-12345",
      GOOGLE_DRIVE_FOLDER_ID: "drive-folder-12345",
    };

    const config = parseEnv(mockEnv);
    expect(config.GEMINI_API_KEYS).toEqual(["key1", "key2", "key3"]);
    expect(config.SUPABASE_URL).toBe("https://example.supabase.co");
    expect(config.SUPER_ADMIN_PHONE).toEqual(["6281346367235", "232130131046571"]);
  });

  it("should throw error if required fields are missing", () => {
    const invalidEnv = {
      GEMINI_API_KEYS: "",
    };

    expect(() => parseEnv(invalidEnv as any)).toThrow();
  });
});
