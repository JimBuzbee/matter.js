/**
 * @license
 * Copyright 2022-2025 Matter.js Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bytes, Crypto, PrivateKey, Time, toHex } from "#general";
import { VendorId } from "#types";
import { CertificateManager, jsToMatterDate } from "./CertificateManager.js";
import {
    TestCert_PAA_NoVID_PrivateKey,
    TestCert_PAA_NoVID_PublicKey,
    TestCert_PAA_NoVID_SKID,
} from "./ChipPAAuthorities.js";

function getPaiCommonName(vendorId: VendorId, productId?: number) {
    return `node-matter Dev PAI 0x${vendorId.toString(16).toUpperCase()} ${
        productId === undefined ? "no PID" : `0x${productId.toString(16).toUpperCase()}`
    }`;
}

function getDacCommonName(vendorId: VendorId, productId: number) {
    return `node-matter Dev DAC 0x${vendorId.toString(16).toUpperCase()}/0x${productId.toString(16).toUpperCase()}`;
}

function getPaaCommonName() {
    // Do not change this because we use the official Matter Test PAA and the certificate uses this name!
    return "Matter Test PAA";
}

export class AttestationCertificateManager {
    private paaCertId = BigInt(0);

    // We use the official PAA cert for now because else pairing with Chip tool do not work because
    // only this one is the Certificate store
    readonly #paaKeyPair = PrivateKey(TestCert_PAA_NoVID_PrivateKey, {
        publicKey: TestCert_PAA_NoVID_PublicKey,
    });
    readonly #certs: CertificateManager;
    readonly #vendorId: VendorId;
    readonly #paiKeyPair: PrivateKey;
    readonly #paiKeyIdentifier: Uint8Array;
    readonly #paaKeyIdentifier = TestCert_PAA_NoVID_SKID;
    readonly #paiCertId = BigInt(1);
    readonly #paiCertBytes;
    #nextCertificateId = 2;

    constructor(crypto: Crypto, vendorId: VendorId, paiKeyPair: PrivateKey, paiKeyIdentifier: Uint8Array) {
        this.#certs = new CertificateManager(crypto);
        this.#vendorId = vendorId;
        this.#paiKeyPair = paiKeyPair;
        this.#paiKeyIdentifier = paiKeyIdentifier;
        this.#paiCertBytes = this.generatePAICert(vendorId);
    }

    static async create(crypto: Crypto, vendorId: VendorId) {
        const key = await crypto.createKeyPair();
        const identifier = await crypto.computeSha256(key.publicKey);
        return new AttestationCertificateManager(crypto, vendorId, key, identifier.slice(0, 20));
    }

    getPAICert() {
        return this.#paiCertBytes;
    }

    async getDACert(productId: number) {
        const dacKeyPair = await this.#certs.crypto.createKeyPair();
        return {
            keyPair: dacKeyPair,
            dac: await this.generateDaCert(dacKeyPair.publicKey, this.#vendorId, productId),
        };
    }

    // Method unused for now because we use the official Matter Test PAA, but is functional
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    private generatePAACert(vendorId?: VendorId) {
        const now = Time.get().now();
        const unsignedCertificate = {
            serialNumber: Bytes.fromHex(toHex(this.paaCertId)),
            signatureAlgorithm: 1 /* EcdsaWithSHA256 */,
            publicKeyAlgorithm: 1 /* EC */,
            ellipticCurveIdentifier: 1 /* P256v1 */,
            issuer: {
                commonName: getPaaCommonName(),
                vendorId: vendorId,
            },
            notBefore: jsToMatterDate(now, -1),
            notAfter: jsToMatterDate(now, 10),
            subject: {
                commonName: getPaaCommonName(),
                vendorId: vendorId,
            },
            ellipticCurvePublicKey: this.#paaKeyPair.publicKey,
            extensions: {
                basicConstraints: {
                    isCa: true,
                    pathLen: 1,
                },
                keyUsage: {
                    keyCertSign: true,
                    cRLSign: true,
                },
                subjectKeyIdentifier: this.#paaKeyIdentifier,
                authorityKeyIdentifier: this.#paaKeyIdentifier,
            },
        };
        return this.#certs.productAttestationAuthorityCertToAsn1(unsignedCertificate, this.#paaKeyPair);
    }

    private generatePAICert(vendorId: VendorId, productId?: number) {
        const now = Time.get().now();
        const unsignedCertificate = {
            serialNumber: Bytes.fromHex(toHex(this.#paiCertId)),
            signatureAlgorithm: 1 /* EcdsaWithSHA256 */,
            publicKeyAlgorithm: 1 /* EC */,
            ellipticCurveIdentifier: 1 /* P256v1 */,
            issuer: {
                commonName: getPaaCommonName(),
            },
            notBefore: jsToMatterDate(now, -1),
            notAfter: jsToMatterDate(now, 10),
            subject: {
                commonName: getPaiCommonName(vendorId, productId),
                vendorId: vendorId,
                productId: productId,
            },
            ellipticCurvePublicKey: this.#paiKeyPair.publicKey,
            extensions: {
                basicConstraints: {
                    isCa: true,
                    pathLen: 0,
                },
                keyUsage: {
                    keyCertSign: true,
                    cRLSign: true,
                },
                subjectKeyIdentifier: this.#paiKeyIdentifier,
                authorityKeyIdentifier: this.#paaKeyIdentifier,
            },
        };
        return this.#certs.productAttestationIntermediateCertToAsn1(unsignedCertificate, this.#paaKeyPair);
    }

    async generateDaCert(publicKey: Uint8Array, vendorId: VendorId, productId: number) {
        const now = Time.get().now();
        const certId = this.#nextCertificateId++;
        const unsignedCertificate = {
            serialNumber: Bytes.fromHex(toHex(certId)),
            signatureAlgorithm: 1 /* EcdsaWithSHA256 */,
            publicKeyAlgorithm: 1 /* EC */,
            ellipticCurveIdentifier: 1 /* P256v1 */,
            notBefore: jsToMatterDate(now, -1),
            notAfter: jsToMatterDate(now, 10),
            issuer: {
                commonName: getPaiCommonName(vendorId),
                vendorId: vendorId,
            },
            subject: {
                commonName: getDacCommonName(vendorId, productId),
                vendorId: vendorId,
                productId: productId,
            },
            ellipticCurvePublicKey: publicKey,
            extensions: {
                basicConstraints: {
                    isCa: false,
                },
                keyUsage: {
                    digitalSignature: true,
                },
                subjectKeyIdentifier: (await this.#certs.crypto.computeSha256(publicKey)).slice(0, 20),
                authorityKeyIdentifier: this.#paiKeyIdentifier,
            },
        };
        return this.#certs.deviceAttestationCertToAsn1(unsignedCertificate, this.#paiKeyPair);
    }
}
