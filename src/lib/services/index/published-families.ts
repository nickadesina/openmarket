/**
 * The filer families the published routes compute with: data/index/filer-families.json
 * as it was when the deployment was built. The file is imported, not read
 * from disk, so the bundler puts it in every server bundle that needs it; a
 * Vercel function does not otherwise carry files under data/. A change to the
 * file reaches the routes with the next deploy, and every payload names the
 * version it used (`families_version`).
 *
 * The scripts keep reading the working tree's file (data-files.ts).
 */
import file from "../../../../data/index/filer-families.json";
import { type FilerFamilies, parseFilerFamilies } from "../../engine/index/families.js";

export const PUBLISHED_FILER_FAMILIES: FilerFamilies = parseFilerFamilies(file);
