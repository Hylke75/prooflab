import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "@/lib/fetch-page";

describe("page fetching never reaches internal addresses", () => {
  it("blocks private, loopback, link-local and special IPv4 ranges", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "192.0.0.8", "0.0.0.0", "224.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it("blocks IPv6 forms that carry an internal IPv4 address", () => {
    for (const ip of ["::1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "fec0::1", "fd00::1", "fe80::1", "::"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it("allows normal public addresses", () => {
    for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});
