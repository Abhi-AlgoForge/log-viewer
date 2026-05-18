import { api } from "./api";
import {
  sessionStore,
  setSession,
  setFilterSession,
  clearFilterFor,
} from "../state/session";

export { filterHighlightRegex } from "../utils/filterDsl";

/// Apply a filter query against the active source. Centralized so the toolbar,
/// sidebar (pattern click), and trace-stitching can all use the same path.
export async function applyFilterToActive(query: string) {
  setSession("filterQuery", query);
  const sid = sessionStore.activeSourceId;
  if (!sid) return;
  try {
    if (query.trim() === "") {
      await api.clearFilter(sid);
      clearFilterFor(sid);
    } else {
      const status = await api.applyFilter(sid, query);
      setFilterSession({
        sourceId: sid,
        filterId: status.filterId,
        query,
        scanned: status.scanned,
        total: status.total,
        matches: status.matches,
        done: status.done,
        isEmptyFilter: status.isEmptyFilter,
      });
    }
  } catch (e) {
    console.error("apply filter failed", e);
  }
}
