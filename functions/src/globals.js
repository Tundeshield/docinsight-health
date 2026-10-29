// Imported first by index.js so these options apply to every function definition.
import { setGlobalOptions } from "firebase-functions/v2";
import { REGION } from "./config.js";
setGlobalOptions({ region: REGION, maxInstances: 20 });
