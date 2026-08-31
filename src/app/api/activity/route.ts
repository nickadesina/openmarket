import {
  assertOnlyQueryParameters,
  parseBoundedInteger,
  parseOptionalString,
  parseSlug,
} from "../../../lib/api/pagination.js";
import { withReadRoute } from "../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  getActivity,
  type ActivityOptions,
} from "../../../lib/services/get-activity.js";

export const runtime = "nodejs";

const MAX_CURSOR_LENGTH = 512;

export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["slug", "cursor", "limit"]);

    const rawSlug = parseOptionalString(searchParams, "slug", {
      maximumLength: 100,
    });
    const cursor = parseOptionalString(searchParams, "cursor", {
      maximumLength: MAX_CURSOR_LENGTH,
    });
    const limit = parseBoundedInteger(searchParams, "limit", {
      defaultValue: ACTIVITY_DEFAULT_LIMIT,
      minimum: 1,
      maximum: ACTIVITY_MAX_LIMIT,
    });
    const options: ActivityOptions = {
      ...(rawSlug === undefined ? {} : { slug: parseSlug(rawSlug) }),
      ...(cursor === undefined ? {} : { cursor }),
      limit,
    };

    const activity = await getActivity(context.db, options);
    return jsonSuccess(activity, { requestId: context.requestId });
  });
}
