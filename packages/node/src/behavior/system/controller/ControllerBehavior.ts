/**
 * @license
 * Copyright 2022-2025 Matter.js Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Behavior } from "#behavior/Behavior.js";
import { BasicInformationBehavior } from "#behaviors/basic-information";
import { ImplementationError, Logger, MatterAggregateError } from "#general";
import {
    Ble,
    FabricAuthority,
    FabricAuthorityConfigurationProvider,
    FabricManager,
    MdnsService,
    ScannerSet,
} from "#protocol";
import type { CommissioningClient } from "../commissioning/CommissioningClient.js";
import { CommissioningServer } from "../commissioning/CommissioningServer.js";
import { NetworkServer } from "../network/NetworkServer.js";
import { ActiveDiscoveries } from "./discovery/ActiveDiscoveries.js";
import type { Discovery } from "./discovery/Discovery.js";

const logger = Logger.get("ControllerBehavior");

/**
 * Node controller functionality.
 *
 * For our purposes, a "controller" is a node that supports commissioning of remote devices.
 *
 * This class initializes components required for controller usage and tracks active discoveries.  Discovery logic
 * resides in {@link Discovery} and commissioning logic in {@link CommissioningClient}.
 */
export class ControllerBehavior extends Behavior {
    static override readonly id = "controller";

    declare state: ControllerBehavior.State;

    override async initialize() {
        if (this.state.adminFabricLabel === undefined) {
            throw new ImplementationError("adminFabricLabel must be set for ControllerBehavior.");
        }
        const adminFabricLabel = this.state.adminFabricLabel;

        // Configure discovery transports
        if (this.state.ip === undefined) {
            this.state.ip = true;
        }
        if (this.state.ip !== false) {
            this.env.get(ScannerSet).add((await this.env.load(MdnsService)).scanner);
        }

        if (this.state.ble === undefined) {
            this.state.ble = (await this.agent.load(NetworkServer)).state.ble;
        }
        if (this.state.ble !== false) {
            this.env.get(ScannerSet).add(Ble.get().getBleScanner());
        }

        // Configure management of controlled fabrics
        if (!this.env.has(FabricAuthorityConfigurationProvider)) {
            const biState = this.endpoint.stateOf(BasicInformationBehavior);
            this.env.set(
                FabricAuthorityConfigurationProvider,
                new (class extends FabricAuthorityConfigurationProvider {
                    get vendorId() {
                        return biState.vendorId;
                    }

                    override get adminFabricLabel() {
                        return adminFabricLabel;
                    }
                })(),
            );
        }

        // "Automatic" controller mode - disable commissioning if node is not otherwise configured as a commissionable
        // device
        const commissioning = this.agent.get(CommissioningServer);
        if (commissioning.state.enabled === undefined) {
            const controlledFabrics = this.env.get(FabricAuthority).fabrics.length;
            const totalFabrics = this.env.get(FabricManager).length;
            if (controlledFabrics === totalFabrics) {
                commissioning.state.enabled = false;
            }
        }
    }

    override async [Symbol.asyncDispose]() {
        const discoveries = this.env.get(ActiveDiscoveries);
        while (discoveries.size) {
            for (const discovery of discoveries) {
                discovery.cancel();
            }

            await MatterAggregateError.allSettled([...discoveries], "Error while cancelling discoveries").catch(error =>
                logger.error(error),
            );
        }
    }
}

export namespace ControllerBehavior {
    export class State {
        /**
         * Set to false to disable scanning on BLE.
         *
         * By default the controller scans via BLE if BLE is available.
         */
        ble?: boolean = undefined;

        /**
         * Set to false to disable scanning on IP networks.
         *
         * By default the controller always scans on IP networks.
         */
        ip?: boolean = undefined;

        /**
         * Contains the label of the admin fabric which is set for all commissioned devices
         */
        adminFabricLabel!: string;
    }
}
