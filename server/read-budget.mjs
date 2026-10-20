import {scheduleReads} from './paginated-read.mjs';
// A process-wide ceiling prevents each open browser from multiplying DB fan-out.
// Values are never shared between callers: every request retains its own token/RLS.
const bulk=scheduleReads((run)=>run(),8);
const calculations=scheduleReads((run)=>run(),1);
export const bulkRead=run=>bulk(run);
export const calculationRead=run=>calculations(run);
