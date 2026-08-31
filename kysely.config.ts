import { createDirectDatabase } from "./src/lib/db/client.js";
import { MIGRATION_FOLDER } from "./src/lib/db/migrator.js";

const config = {
  connectionStringEnvironmentVariable: "DATABASE_URL_UNPOOLED",
  createDatabase: createDirectDatabase,
  migrations: {
    migrationFolder: MIGRATION_FOLDER,
  },
} as const;

export default config;
