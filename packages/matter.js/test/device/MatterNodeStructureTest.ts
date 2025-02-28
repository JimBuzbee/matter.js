/**
 * @license
 * Copyright 2022-2025 Matter.js Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdministratorCommissioningHandler } from "#cluster/server/AdministratorCommissioningServer.js";
import { ClusterServer } from "#cluster/server/ClusterServer.js";
import { GeneralCommissioningClusterHandler } from "#cluster/server/GeneralCommissioningServer.js";
import { GroupKeyManagementClusterHandler } from "#cluster/server/GroupKeyManagementServer.js";
import { OperationalCredentialsClusterHandler } from "#cluster/server/OperationalCredentialsServer.js";
import {
    AccessControlCluster,
    AdministratorCommissioning,
    BasicInformationCluster,
    BindingCluster,
    BridgedDeviceBasicInformationCluster,
    DescriptorCluster,
    FixedLabelCluster,
    GeneralCommissioning,
    GeneralDiagnostics,
    GroupKeyManagementCluster,
    GroupsCluster,
    Identify,
    IdentifyCluster,
    NetworkCommissioning,
    OnOffCluster,
    OperationalCredentialsCluster,
} from "#clusters";
import { CommissioningServer } from "#CommissioningServer.js";
import { Aggregator } from "#device/Aggregator.js";
import { ComposedDevice } from "#device/ComposedDevice.js";
import { RootEndpoint } from "#device/Device.js";
import { DeviceTypes } from "#device/DeviceTypes.js";
import { Endpoint } from "#device/Endpoint.js";
import { OnOffPluginUnitDevice } from "#device/OnOffDevices.js";
import { Bytes, ImplementationError, serialize, StorageBackendMemory, StorageContext, StorageManager } from "#general";
import { ClusterModel, MatterModel, Specification } from "#model";
import { attributePathToId, AttributeServer, InteractionEndpointStructure } from "#protocol";
import { DeviceTypeId, EndpointNumber, FabricIndex, VendorId } from "#types";
import { DUMMY_KEY, PRIVATE_KEY } from "../support/mock-keys.js";

function addRequiredRootClusters(
    rootEndpoint: Endpoint,
    includeAdminCommissioningCluster = true,
    includeBasicInformationCluster = true,
) {
    if (includeBasicInformationCluster) {
        rootEndpoint.addClusterServer(
            ClusterServer(
                BasicInformationCluster,
                {
                    dataModelRevision: 1,
                    vendorName: "vendor",
                    vendorId: VendorId(1),
                    productName: "product",
                    productId: 2,
                    nodeLabel: "",
                    hardwareVersion: 0,
                    hardwareVersionString: "0",
                    location: "US",
                    localConfigDisabled: false,
                    softwareVersion: 1,
                    softwareVersionString: "v1",
                    capabilityMinima: {
                        caseSessionsPerFabric: 3,
                        subscriptionsPerFabric: 3,
                    },
                    serialNumber: `node-matter-0000`,
                    specificationVersion: Specification.SPECIFICATION_VERSION,
                    maxPathsPerInvoke: 1,
                },
                {},
                {
                    startUp: true,
                    shutDown: true,
                    leave: true,
                },
            ),
        );

        rootEndpoint.addClusterServer(
            ClusterServer(
                OperationalCredentialsCluster,
                {
                    nocs: [],
                    fabrics: [],
                    supportedFabrics: 254,
                    commissionedFabrics: 0,
                    trustedRootCertificates: [],
                    currentFabricIndex: FabricIndex.NO_FABRIC,
                },
                OperationalCredentialsClusterHandler({
                    privateKey: DUMMY_KEY,
                    certificate: Bytes.fromHex("00"),
                    intermediateCertificate: Bytes.fromHex("00"),
                    declaration: Bytes.fromHex("00"),
                }),
            ),
        );
    }

    rootEndpoint.addClusterServer(
        ClusterServer(
            GeneralCommissioning.Cluster,
            {
                breadcrumb: BigInt(0),
                basicCommissioningInfo: {
                    failSafeExpiryLengthSeconds: 60 /* 1min */,
                    maxCumulativeFailsafeSeconds: 900 /* Recommended according to Specs */,
                },
                regulatoryConfig: GeneralCommissioning.RegulatoryLocationType.Indoor,
                locationCapability: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                supportsConcurrentConnection: true,
            },
            GeneralCommissioningClusterHandler(),
        ),
    );

    rootEndpoint.addClusterServer(
        ClusterServer(
            NetworkCommissioning.Cluster.with("EthernetNetworkInterface"),
            {
                maxNetworks: 1,
                interfaceEnabled: true,
                lastConnectErrorValue: 0,
                lastNetworkId: Bytes.fromHex("0000000000000000000000000000000000000000000000000000000000000000"),
                lastNetworkingStatus: NetworkCommissioning.NetworkCommissioningStatus.Success,
                networks: [
                    {
                        networkId: Bytes.fromHex("0000000000000000000000000000000000000000000000000000000000000000"),
                        connected: true,
                    },
                ],
            },
            {},
        ),
    );

    rootEndpoint.addClusterServer(
        ClusterServer(
            AccessControlCluster,
            {
                acl: [],
                extension: [],
                subjectsPerAccessControlEntry: 4,
                targetsPerAccessControlEntry: 4,
                accessControlEntriesPerFabric: 4,
            },
            {},
            {
                accessControlEntryChanged: true,
                accessControlExtensionChanged: true,
            },
        ),
    );

    rootEndpoint.addClusterServer(
        ClusterServer(
            GroupKeyManagementCluster,
            {
                groupKeyMap: [],
                groupTable: [],
                maxGroupsPerFabric: 0,
                maxGroupKeysPerFabric: 1,
            },
            GroupKeyManagementClusterHandler(),
        ),
    );

    rootEndpoint.addClusterServer(
        ClusterServer(
            GeneralDiagnostics.Cluster,
            {
                networkInterfaces: [],
                rebootCount: 0,
                upTime: 0,
                totalOperationalHours: 0,
                bootReason: GeneralDiagnostics.BootReason.Unspecified,
                activeHardwareFaults: [],
                activeRadioFaults: [],
                activeNetworkFaults: [],
                testEventTriggersEnabled: false,
            },
            {
                testEventTrigger: async () => {
                    /* ignore */
                },
                timeSnapshot: async () => ({
                    systemTimeMs: 0,
                    posixTimeMs: 0,
                }),
            },
            {
                bootReason: true,
            },
        ),
    );

    if (includeAdminCommissioningCluster) {
        rootEndpoint.addClusterServer(
            ClusterServer(
                AdministratorCommissioning.Cluster,
                {
                    windowStatus: AdministratorCommissioning.CommissioningWindowStatus.WindowNotOpen,
                    adminFabricIndex: null,
                    adminVendorId: null,
                },
                AdministratorCommissioningHandler(),
            ),
        );
    }
}

export interface PathCounts {
    attribute?: number;
    command?: number;
}

export type PathSummary = Array<Record<string, PathCounts>>;

const clusterNames = {} as Record<number, string>;
function nameOfCluster(clusterId: number) {
    let name = clusterNames[clusterId];
    if (name === undefined) {
        name = clusterNames[clusterId] =
            MatterModel.standard.get(ClusterModel, clusterId)?.name ?? clusterId.toString();
    }
    return name;
}

function expectPaths(structure: InteractionEndpointStructure, ...expected: PathSummary) {
    let result = [] as PathSummary;

    function summarize(type: keyof PathCounts) {
        const paths = structure[`${type}Paths`];

        for (const path of paths) {
            const forEndpoint = (result[path.endpointId] ??= {});
            const forCluster = (forEndpoint[nameOfCluster(path.clusterId)] ??= {});
            forCluster[type] = (forCluster[type] ?? 0) + 1;
        }
    }

    summarize("attribute");
    summarize("command");

    result = result.filter(entry => entry !== undefined);

    try {
        expect(result).deep.equals(expected);
    } catch (e) {
        // Change the message so the summary is easy to pull out and stick in the test
        (e as Error).message = `Incorrect path result: ${result.map(serialize).join(", ")}`;

        throw e;
    }
}

let testStorageManager: StorageManager;
let endpointStorage: StorageContext;
let rootEndpoint: Endpoint;

async function commissioningServer({ storage, values }: { storage?: boolean; values?: Record<string, any> } = {}) {
    const testStorage = new StorageBackendMemory();
    testStorageManager = new StorageManager(testStorage);
    await testStorageManager.initialize();
    const testStorageContext = testStorageManager.createContext("TestContext");
    endpointStorage = testStorageContext.createContext("EndpointStructure");

    const node = new CommissioningServer({
        port: 5540,
        deviceName: "Test Device",
        deviceType: DeviceTypeId(0x16),
        passcode: 123,
        discriminator: 1234,
        basicInformation: {
            dataModelRevision: 1,
            vendorName: "vendor",
            vendorId: VendorId(1),
            productName: "product",
            productId: 2,
            nodeLabel: "",
            hardwareVersion: 0,
            hardwareVersionString: "0",
            location: "US",
            localConfigDisabled: false,
            softwareVersion: 1,
            softwareVersionString: "v1",
            capabilityMinima: {
                caseSessionsPerFabric: 3,
                subscriptionsPerFabric: 3,
            },
            serialNumber: `node-matter-0000`,
        },
        certificates: {
            privateKey: PRIVATE_KEY,
            certificate: Bytes.fromHex("00"),
            intermediateCertificate: Bytes.fromHex("00"),
            declaration: Bytes.fromHex("00"),
        },
    });

    if (storage !== false) {
        await node.setStorage(testStorageContext);
    }

    if (values) {
        for (const key in values) {
            await endpointStorage.set(key, values[key]);
        }
    }

    rootEndpoint = node.getRootEndpoint();

    addRequiredRootClusters(rootEndpoint);
    return node;
}

describe("Endpoint Structures", () => {
    describe("Simple Endpoint structure", () => {
        it("Root Endpoint with missing required cluster throws exception", () => {
            const root = new RootEndpoint();
            addRequiredRootClusters(root, false);

            expect(() => root.verifyRequiredClusters()).throw(
                ImplementationError,
                "Device type MA-rootdevice (0x16) requires cluster server AdministratorCommissioning(0x3c) but it is not present on endpoint 0",
            );
        });

        it("Just root Endpoint", async () => {
            const node = await commissioningServer({ storage: false });

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([]);

            const rootPartsListAttribute2 = endpointStructure.getAttributes([
                {
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                },
            ]);
            expect(rootPartsListAttribute2.length).equal(1);
            expect(rootPartsListAttribute).equal(rootPartsListAttribute2[0].attribute);

            expect(endpoints.size).equal(1);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expectPaths(endpointStructure, {
                Descriptor: { attribute: 9 },
                BasicInformation: { attribute: 21 },
                OperationalCredentials: { attribute: 11, command: 8 },
                GeneralCommissioning: { attribute: 10, command: 3 },
                AccessControl: { attribute: 10 },
                GroupKeyManagement: { attribute: 9, command: 4 },
                GeneralDiagnostics: { attribute: 14, command: 2 },
                AdministratorCommissioning: { attribute: 8, command: 2 },
                NetworkCommissioning: { attribute: 11 },
            });

            const basicInformationCluster = rootEndpoint.getClusterServer(BasicInformationCluster);
            expect(basicInformationCluster).exist;
            expect((basicInformationCluster?.attributes as any).attributeList.get().length).equal(21);
            expect((basicInformationCluster?.attributes as any).generatedCommandList.get().length).equal(0);
            expect((basicInformationCluster?.attributes as any).acceptedCommandList.get().length).equal(0);

            const generalCommissioningCluster = rootEndpoint.getClusterServer(GeneralCommissioning.Cluster);
            expect(generalCommissioningCluster).exist;
            expect((generalCommissioningCluster?.attributes as any).attributeList.get().length).equal(10);
            expect((generalCommissioningCluster?.attributes as any).generatedCommandList.get().length).equal(3);
            expect((generalCommissioningCluster?.attributes as any).acceptedCommandList.get().length).equal(3);
        });

        it("One device with one Light endpoint - no unique id, use index", async () => {
            const node = await commissioningServer();

            const onoffDevice = new OnOffPluginUnitDevice();

            node.addDevice(onoffDevice);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(2);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpointStorage.get("serial_node-matter-0000-index_0")).equal(1);

            expect(endpoints.size).equal(2);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(1)]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );
        });

        it("One device with one Light endpoints - with uniqueid", async () => {
            const node = await commissioningServer();

            const onoffDevice = new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "test-unique-id" });

            node.addDevice(onoffDevice);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(2);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpointStorage.get("serial_node-matter-0000-custom_test-unique-id")).equal(1);

            expect(endpoints.size).equal(2);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(1)]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );
        });

        it("One device with one Light endpoints - no uniqueid, use index, from storage", async () => {
            const node = await commissioningServer({
                values: { "serial_node-matter-0000-index_0": 10 },
            });

            const onoffDevice = new OnOffPluginUnitDevice();

            node.addDevice(onoffDevice);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(11);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpointStorage.get("serial_node-matter-0000-index_0")).equal(10);

            expect(endpoints.size).equal(2);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(10))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(10)]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );
        });

        it("One device with one Light endpoints - with uniqueid, from storage", async () => {
            const node = await commissioningServer({
                values: { "serial_node-matter-0000-custom_test-unique-id": 10 },
            });

            const onoffDevice = new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "test-unique-id" });

            node.addDevice(onoffDevice);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(11);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpointStorage.get("serial_node-matter-0000-custom_test-unique-id")).equal(10);

            expect(endpoints.size).equal(2);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(10))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(10))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(10)]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );
        });
    });

    describe("Aggregator/Bridged Endpoint structures", () => {
        it("Creating Structure with duplicate endpoint id throws error", () => {
            const rootEndpoint = new RootEndpoint();
            addRequiredRootClusters(rootEndpoint);

            const aggregator = new Aggregator([], { endpointId: EndpointNumber(1) });

            const onoffDevice = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(11) });
            onoffDevice.addClusterServer(
                ClusterServer(
                    BridgedDeviceBasicInformationCluster,
                    {
                        nodeLabel: "Socket 1",
                        reachable: true,
                    },
                    {},
                    {
                        reachableChanged: true,
                    },
                ),
            );

            aggregator.addBridgedDevice(onoffDevice);
            expect(() => aggregator.addBridgedDevice(onoffDevice)).throw(
                `Endpoint with id 11 already exists as child from 1.`,
            );
        });

        it("Aggregator Structure with one OnOff endpoint and defined endpoint IDs", () => {
            const rootEndpoint = new RootEndpoint();
            addRequiredRootClusters(rootEndpoint);

            const aggregator = new Aggregator([], { endpointId: EndpointNumber(1) });

            const onoffDevice = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(11) });
            onoffDevice.addClusterServer(
                ClusterServer(
                    BridgedDeviceBasicInformationCluster,
                    {
                        nodeLabel: "Socket 1",
                        reachable: true,
                    },
                    {},
                    {
                        reachableChanged: true,
                    },
                ),
            );

            aggregator.addBridgedDevice(onoffDevice);
            rootEndpoint.addChildEndpoint(aggregator);

            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(3);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(1);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;

            expect(endpoints.get(EndpointNumber(11))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(1), EndpointNumber(11)]);

            const aggregatorPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregatorPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(11)]);

            const AggregatorEndpointTypeListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.deviceTypeList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(AggregatorEndpointTypeListAttribute?.getLocal()).deep.equal([
                {
                    deviceType: DeviceTypeId(DeviceTypes.AGGREGATOR.code),
                    revision: 1,
                },
            ]);

            const devicePartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(11),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(devicePartsListAttribute?.getLocal()).deep.equal([]);

            const deviceTypeListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(11),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.deviceTypeList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(deviceTypeListAttribute?.getLocal()).deep.equal([
                {
                    deviceType: DeviceTypeId(DeviceTypes.ON_OFF_PLUGIN_UNIT.code),
                    revision: 2,
                },
                {
                    deviceType: DeviceTypeId(DeviceTypes.BRIDGED_NODE.code),
                    revision: 1,
                },
            ]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    NetworkCommissioning: { attribute: 11 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                },
                { Descriptor: { attribute: 9 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
            );
        });

        it("Device Structure with one aggregator and two plug endpoints and defined endpoint IDs", () => {
            const rootEndpoint = new RootEndpoint();
            addRequiredRootClusters(rootEndpoint);

            const aggregator = new Aggregator([], { endpointId: EndpointNumber(1) });

            const onoffDevice11 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(11) });
            const onoffDevice12 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(12) });

            aggregator.addBridgedDevice(onoffDevice11, {
                nodeLabel: "Socket 1",
                reachable: true,
            });
            aggregator.addBridgedDevice(onoffDevice12, {
                nodeLabel: "Socket 2",
                reachable: true,
            });
            rootEndpoint.addChildEndpoint(aggregator);

            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(4);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(1);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;

            expect(endpoints.get(EndpointNumber(11))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(12))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(BindingCluster)).ok;

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(1),
                EndpointNumber(11),
                EndpointNumber(12),
            ]);

            const aggregatorPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregatorPartsListAttribute?.getLocal()).deep.equal([EndpointNumber(11), EndpointNumber(12)]);

            const AggregatorEndpointTypeListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.deviceTypeList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(AggregatorEndpointTypeListAttribute?.getLocal()).deep.equal([
                {
                    deviceType: DeviceTypeId(DeviceTypes.AGGREGATOR.code),
                    revision: 1,
                },
            ]);

            const devicePartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(11),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(devicePartsListAttribute?.getLocal()).deep.equal([]);

            const deviceTypeListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(11),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.deviceTypeList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(deviceTypeListAttribute?.getLocal()).deep.equal([
                {
                    deviceType: DeviceTypeId(DeviceTypes.ON_OFF_PLUGIN_UNIT.code),
                    revision: 2,
                },
                {
                    deviceType: DeviceTypeId(DeviceTypes.BRIDGED_NODE.code),
                    revision: 1,
                },
            ]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    NetworkCommissioning: { attribute: 11 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                },
                { Descriptor: { attribute: 9 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
            );
        });

        it("Device Structure with two aggregators and two OnOff endpoints and defined endpoint IDs", () => {
            const rootEndpoint = new RootEndpoint();
            addRequiredRootClusters(rootEndpoint);

            const aggregator1 = new Aggregator([], { endpointId: EndpointNumber(1) });
            aggregator1.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type A" }],
                    },
                    {},
                ),
            );

            const onoffDevice11 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(11) });
            const onoffDevice12 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(12) });

            aggregator1.addBridgedDevice(onoffDevice11, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            aggregator1.addBridgedDevice(onoffDevice12, {
                nodeLabel: "Socket 1-2",
                reachable: true,
            });
            rootEndpoint.addChildEndpoint(aggregator1);

            const aggregator2 = new Aggregator([], { endpointId: EndpointNumber(2) });
            aggregator2.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type B" }],
                    },
                    {},
                ),
            );

            const onoffDevice21 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(21) });
            const onoffDevice22 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(22) });

            aggregator2.addBridgedDevice(onoffDevice21, {
                nodeLabel: "Socket 2-1",
                reachable: true,
            });
            aggregator2.addBridgedDevice(onoffDevice22, {
                nodeLabel: "Socket 2-2",
                reachable: true,
            });
            rootEndpoint.addChildEndpoint(aggregator2);

            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(7);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(11))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(11))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(12))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(12))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(2))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(21))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(21))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(22))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(22))?.hasClusterServer(BindingCluster)).ok;

            const aggregator1PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator1PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(11), EndpointNumber(12)]);

            const aggregator2PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(2),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(21), EndpointNumber(22)]);

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(1),
                EndpointNumber(11),
                EndpointNumber(12),
                EndpointNumber(2),
                EndpointNumber(21),
                EndpointNumber(22),
            ]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    NetworkCommissioning: { attribute: 11 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
            );
        });

        it("Device Structure with two aggregators and two Light endpoints and all auto-assigned endpoint IDs", async () => {
            const node = await commissioningServer();

            const aggregator1 = new Aggregator();
            aggregator1.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type A" }],
                    },
                    {},
                ),
            );

            const onoffDevice11 = new OnOffPluginUnitDevice();
            const onoffDevice12 = new OnOffPluginUnitDevice();

            aggregator1.addBridgedDevice(onoffDevice11, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            aggregator1.addBridgedDevice(onoffDevice12, {
                nodeLabel: "Socket 1-2",
                reachable: true,
            });
            node.addDevice(aggregator1);

            const aggregator2 = new Aggregator();
            aggregator2.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type B" }],
                    },
                    {},
                ),
            );

            const onoffDevice21 = new OnOffPluginUnitDevice();
            const onoffDevice22 = new OnOffPluginUnitDevice();

            aggregator2.addBridgedDevice(onoffDevice21, {
                nodeLabel: "Socket 2-1",
                reachable: true,
            });
            aggregator2.addBridgedDevice(onoffDevice22, {
                nodeLabel: "Socket 2-2",
                reachable: true,
            });
            node.addDevice(aggregator2);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(7);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(7);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(1))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(1))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(2))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(2))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(3))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(4))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(4))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(4))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(5))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(5))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(6))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(6))?.hasClusterServer(BindingCluster)).ok;

            const aggregator1PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(1),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator1PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(2), EndpointNumber(3)]);

            const aggregator2PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(4),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(5), EndpointNumber(6)]);

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(1),
                EndpointNumber(2),
                EndpointNumber(3),
                EndpointNumber(4),
                EndpointNumber(5),
                EndpointNumber(6),
            ]);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
            );
        });

        it("Device Structure with two aggregators and three Light/Composed endpoints and all partly auto-assigned endpoint IDs", async () => {
            const node = await commissioningServer();

            const aggregator1 = new Aggregator([], { endpointId: EndpointNumber(37) });
            aggregator1.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type A" }],
                    },
                    {},
                ),
            );

            const onoffDevice11 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(3) });
            const onoffDevice12 = new OnOffPluginUnitDevice();

            aggregator1.addBridgedDevice(onoffDevice11, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            aggregator1.addBridgedDevice(onoffDevice12, {
                nodeLabel: "Socket 1-2",
                reachable: true,
            });
            node.addDevice(aggregator1);

            const aggregator2 = new Aggregator();
            aggregator2.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type B" }],
                    },
                    {},
                ),
            );

            const onoffDevice21 = new OnOffPluginUnitDevice();
            const onoffDevice22 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(18) });

            aggregator2.addBridgedDevice(onoffDevice21, {
                nodeLabel: "Socket 2-1",
                serialNumber: "12345678",
                reachable: true,
            });
            aggregator2.addBridgedDevice(onoffDevice22, {
                nodeLabel: "Socket 2-2",
                reachable: true,
            });

            const composedDevice = new ComposedDevice(DeviceTypes.ON_OFF_PLUGIN_UNIT, [
                new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "COMPOSED.SUB1" }),
                new OnOffPluginUnitDevice(),
            ]);
            aggregator2.addBridgedDevice(composedDevice, {
                nodeLabel: "Composed 2-3",
                uniqueId: "COMPOSED2",
                reachable: true,
            });

            node.addDevice(aggregator2);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(44);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(10);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(37))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(37))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(37))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(3))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(38))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(39))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(39))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(39))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(40))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(18))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(41))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(41))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(41))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;

            expect(endpoints.get(EndpointNumber(42))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(43))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(BindingCluster)).ok;

            const aggregator1PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(37),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator1PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(3), EndpointNumber(38)]);

            const aggregator2PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(39),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(40),
                EndpointNumber(18),
                EndpointNumber(41),
                EndpointNumber(42),
                EndpointNumber(43),
            ]);

            const aggregator2PartsListAttribute2 = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(41),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute2?.getLocal()).deep.equal([EndpointNumber(42), EndpointNumber(43)]);

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(37),
                EndpointNumber(3),
                EndpointNumber(38),
                EndpointNumber(39),
                EndpointNumber(40),
                EndpointNumber(18),
                EndpointNumber(41),
                EndpointNumber(42),
                EndpointNumber(43),
            ]);

            expect(endpointStorage.get("serial_node-matter-0000-index_0-index_1")).equal(38);
            expect(endpointStorage.get("serial_node-matter-0000-index_1-unique_COMPOSED2-custom_COMPOSED.SUB1")).equal(
                42,
            );
            expect(endpointStorage.get("serial_node-matter-0000-index_1-unique_COMPOSED2-index_1")).equal(43);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 8 },
                },
                { Descriptor: { attribute: 9 }, BridgedDeviceBasicInformation: { attribute: 8 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );
        });

        it("Device Structure with two aggregators and three Light/Composed endpoints and all partly auto-assigned endpoint IDs and removing adding devices", async () => {
            const node = await commissioningServer({
                values: { "serial_node-matter-0000-index_0-custom_3333": 3 },
            });

            const aggregator1 = new Aggregator([], { endpointId: EndpointNumber(37) });
            aggregator1.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type A" }],
                    },
                    {},
                ),
            );

            const onoffDevice11 = new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "3333" });
            const onoffDevice12 = new OnOffPluginUnitDevice();

            aggregator1.addBridgedDevice(onoffDevice11, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            aggregator1.addBridgedDevice(onoffDevice12, {
                nodeLabel: "Socket 1-2",
                reachable: true,
            });
            node.addDevice(aggregator1);

            const aggregator2 = new Aggregator();
            aggregator2.addClusterServer(
                ClusterServer(
                    FixedLabelCluster,
                    {
                        labelList: [{ label: "bridge", value: "Type B" }],
                    },
                    {},
                ),
            );

            const onoffDevice21 = new OnOffPluginUnitDevice();
            const onoffDevice22 = new OnOffPluginUnitDevice(undefined, { endpointId: EndpointNumber(18) });

            aggregator2.addBridgedDevice(onoffDevice21, {
                nodeLabel: "Socket 2-1",
                serialNumber: "12345678",
                reachable: true,
            });
            aggregator2.addBridgedDevice(onoffDevice22, {
                nodeLabel: "Socket 2-2",
                reachable: true,
            });

            const composedDevice = new ComposedDevice(DeviceTypes.ON_OFF_PLUGIN_UNIT, [
                new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "COMPOSED.SUB1" }),
                new OnOffPluginUnitDevice(),
            ]);
            aggregator2.addBridgedDevice(composedDevice, {
                nodeLabel: "Composed 2-3",
                uniqueId: "COMPOSED2",
                reachable: true,
            });

            node.addDevice(aggregator2);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(44);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);
            const { endpoints, attributes } = endpointStructure;

            expect(endpoints.size).equal(10);
            expect(endpoints.get(EndpointNumber(0))?.getAllClusterServers().length).equal(9);
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(BasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(OperationalCredentialsCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(NetworkCommissioning.Complete)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AccessControlCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(AdministratorCommissioning.Cluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GroupKeyManagementCluster)).ok;
            expect(endpoints.get(EndpointNumber(0))?.hasClusterServer(GeneralCommissioning.Cluster)).ok;

            expect(endpoints.get(EndpointNumber(37))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(37))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(37))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(3))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(3))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(38))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(38))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(39))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(39))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(39))?.hasClusterServer(FixedLabelCluster)).ok;

            expect(endpoints.get(EndpointNumber(40))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(40))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(18))?.getAllClusterServers().length).equal(6);
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(18))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(41))?.getAllClusterServers().length).equal(2);
            expect(endpoints.get(EndpointNumber(41))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(41))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;

            expect(endpoints.get(EndpointNumber(42))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(42))?.hasClusterServer(BindingCluster)).ok;

            expect(endpoints.get(EndpointNumber(43))?.getAllClusterServers().length).equal(5);
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints.get(EndpointNumber(43))?.hasClusterServer(BindingCluster)).ok;

            const aggregator1PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(37),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator1PartsListAttribute?.getLocal()).deep.equal([EndpointNumber(3), EndpointNumber(38)]);

            const aggregator2PartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(39),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(40),
                EndpointNumber(18),
                EndpointNumber(41),
                EndpointNumber(42),
                EndpointNumber(43),
            ]);

            const aggregator2PartsListAttribute2 = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(41),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(aggregator2PartsListAttribute2?.getLocal()).deep.equal([EndpointNumber(42), EndpointNumber(43)]);

            const rootPartsListAttribute = attributes.get(
                attributePathToId({
                    endpointId: EndpointNumber(0),
                    clusterId: DescriptorCluster.id,
                    attributeId: DescriptorCluster.attributes.partsList.id,
                }),
            ) as AttributeServer<EndpointNumber[]>;
            expect(rootPartsListAttribute?.getLocal()).deep.equal([
                EndpointNumber(37),
                EndpointNumber(3),
                EndpointNumber(38),
                EndpointNumber(39),
                EndpointNumber(40),
                EndpointNumber(18),
                EndpointNumber(41),
                EndpointNumber(42),
                EndpointNumber(43),
            ]);

            expect(endpointStorage.get("serial_node-matter-0000-index_0-index_1")).equal(38);
            expect(endpointStorage.get("serial_node-matter-0000-index_1-unique_COMPOSED2-custom_COMPOSED.SUB1")).equal(
                42,
            );
            expect(endpointStorage.get("serial_node-matter-0000-index_1-unique_COMPOSED2-index_1")).equal(43);

            expectPaths(
                endpointStructure,
                {
                    Descriptor: { attribute: 9 },
                    BasicInformation: { attribute: 21 },
                    OperationalCredentials: { attribute: 11, command: 8 },
                    GeneralCommissioning: { attribute: 10, command: 3 },
                    AccessControl: { attribute: 10 },
                    GroupKeyManagement: { attribute: 9, command: 4 },
                    GeneralDiagnostics: { attribute: 14, command: 2 },
                    AdministratorCommissioning: { attribute: 8, command: 2 },
                    NetworkCommissioning: { attribute: 11 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 7 },
                },
                { Descriptor: { attribute: 9 }, FixedLabel: { attribute: 6 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                    BridgedDeviceBasicInformation: { attribute: 8 },
                },
                { Descriptor: { attribute: 9 }, BridgedDeviceBasicInformation: { attribute: 8 } },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
                {
                    Descriptor: { attribute: 9 },
                    Binding: { attribute: 6 },
                    Identify: { attribute: 7, command: 1 },
                    Groups: { attribute: 6, command: 6 },
                    OnOff: { attribute: 6, command: 3 },
                },
            );

            let structureChangeCounter = 0;
            rootEndpoint.setStructureChangedCallback(() => {
                structureChangeCounter++;

                node.assignEndpointIds();
                rootEndpoint.updatePartsList();
            });

            // Add another device
            const onoffDevice13 = new OnOffPluginUnitDevice();
            aggregator1.addBridgedDevice(onoffDevice13, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            expect(structureChangeCounter).equal(1);
            expect(endpointStorage.get("serial_node-matter-0000-index_0-index_2")).equal(44);

            // And remove one
            aggregator1.removeBridgedDevice(onoffDevice11);

            expect(node.getNextEndpointId(false)).equal(45);
            expect(structureChangeCounter).equal(2);

            const endpointStructure2 = new InteractionEndpointStructure();
            endpointStructure2.initializeFromEndpoint(rootEndpoint);
            const { endpoints: endpoints2 } = endpointStructure2;

            expect(endpoints2.size).equal(10);
            expect(endpoints2.has(EndpointNumber(3))).equal(false);

            expect(endpoints2.get(EndpointNumber(44))?.getAllClusterServers().length).equal(6);
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(DescriptorCluster)).ok;
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(IdentifyCluster)).ok;
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(GroupsCluster)).ok;
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(OnOffCluster)).ok;
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(BindingCluster)).ok;
            expect(endpoints2.get(EndpointNumber(44))?.hasClusterServer(BridgedDeviceBasicInformationCluster)).ok;

            // Add the removed back and verify it gets same endpointID as before
            const onoffDevice11New = new OnOffPluginUnitDevice(undefined, { uniqueStorageKey: "3333" });
            aggregator1.addBridgedDevice(onoffDevice11New, {
                nodeLabel: "Socket 1-1 NEW",
                reachable: true,
            });

            expect(node.getNextEndpointId(false)).equal(45);
            expect(structureChangeCounter).equal(3);

            const endpointStructure3 = new InteractionEndpointStructure();
            endpointStructure3.initializeFromEndpoint(rootEndpoint);
            const { endpoints: endpoints3 } = endpointStructure3;

            expect(endpoints3.size).equal(11);
            expect(endpoints3.get(EndpointNumber(3))?.getAllClusterServers().length).equal(6);
        });
    });

    describe("ClusterServer initialization and destroy", () => {
        it("Init and destroy is called when cluster server are overwritten", async () => {
            const node = await commissioningServer();

            const onoffDevice = new OnOffPluginUnitDevice();

            let initCalled = false;
            let destroyCalled = false;
            // Overwrite Identify Cluster with init and destroy methods
            onoffDevice.addClusterServer(
                ClusterServer(
                    IdentifyCluster,
                    {
                        identifyTime: 0,
                        identifyType: Identify.IdentifyType.None,
                    },
                    {
                        identify: async () => {
                            /* dummy */
                        },
                        initializeClusterServer: async () => {
                            initCalled = true;
                        },
                        destroyClusterServer: async () => {
                            destroyCalled = true;
                        },
                    },
                ),
            );
            expect(initCalled).false;
            expect(destroyCalled).false;

            node.addDevice(onoffDevice);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(2);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            rootEndpoint.setStructureChangedCallback(() => node.updateStructure());
            node.updateStructure();

            expect(initCalled).true;
            expect(destroyCalled).false;

            // Overwrite cluster server - old gets destroyed, new initialized
            let init2Called = false;
            let destroy2Called = false;
            onoffDevice.addClusterServer(
                ClusterServer(
                    IdentifyCluster,
                    {
                        identifyTime: 0,
                        identifyType: Identify.IdentifyType.None,
                    },
                    {
                        identify: async () => {
                            /* dummy */
                        },
                        initializeClusterServer: async () => {
                            init2Called = true;
                        },
                        destroyClusterServer: async () => {
                            destroy2Called = true;
                        },
                    },
                ),
            );
            expect(destroyCalled).true;
            expect(init2Called).true;
            expect(destroy2Called).false;

            await node.close();

            expect(destroy2Called).true;
        });

        it("Destroy is called when device is removed", async () => {
            const node = await commissioningServer();

            const aggregator = new Aggregator();
            const onoffDevice = new OnOffPluginUnitDevice();

            let initCalled = false;
            let destroyCalled = false;
            // Overwrite Identify Cluster with init and destroy methods
            onoffDevice.addClusterServer(
                ClusterServer(
                    IdentifyCluster,
                    {
                        identifyTime: 0,
                        identifyType: Identify.IdentifyType.None,
                    },
                    {
                        identify: async () => {
                            /* dummy */
                        },
                        initializeClusterServer: async () => {
                            initCalled = true;
                        },
                        destroyClusterServer: async () => {
                            destroyCalled = true;
                        },
                    },
                ),
            );
            expect(initCalled).false;
            expect(destroyCalled).false;

            aggregator.addBridgedDevice(onoffDevice, {
                nodeLabel: "Socket 1-1",
                reachable: true,
            });
            node.addDevice(aggregator);

            node.assignEndpointIds();
            expect(node.getNextEndpointId(false)).equal(3);

            const rootEndpoint = node.getRootEndpoint();
            rootEndpoint.updatePartsList();
            rootEndpoint.setStructureChangedCallback(() => node.updateStructure());
            node.updateStructure();

            const endpointStructure = new InteractionEndpointStructure();
            endpointStructure.initializeFromEndpoint(rootEndpoint);

            expect(initCalled).true;
            expect(destroyCalled).false;

            aggregator.removeBridgedDevice(onoffDevice);

            expect(destroyCalled).true;
        });
    });
});
