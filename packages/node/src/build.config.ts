/**
 * @license
 * Copyright 2022-2024 Matter.js Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Project } from "@matter.js/tools";

export async function before({ project }: Project.Context) {
    // We must load "load.cjs" or "load.mjs" via self reference to conditional exports, but typescript won't find the
    // type definition this way unless it's in the dist location.  So copy it there prior to build
    project.copyToDist("src/loader/load.d.ts", "loader/load.d.ts");
}
