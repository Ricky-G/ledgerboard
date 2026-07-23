import { dirname } from "node:path";

export function repositoryRootFromExtensionRoot(extensionRoot) {
    return dirname(dirname(dirname(extensionRoot)));
}
