import { test } from "node:test";
import assert from "node:assert/strict";
import { initialData, legacyCompanyId, validateBackup } from "../src/lib/model";

test("legacy ABC COMPANY contract resolves to the same synthetic company ID used by deletion", () => {
  const id = legacyCompanyId("ABC COMPANY", "LF-2026-210");
  const cloudCopy = validateBackup({
    ...initialData,
    companies: [],
    contracts: [{
      id: "LF-2026-210",
      company: "ABC COMPANY",
      title: "SETUP",
      location: "HYDRABAD",
      value: 600000,
      received: 100000,
      status: "Active",
      instruments: 0,
    }],
  });

  assert.equal(id, "legacy-abc-company");
  assert.deepEqual(cloudCopy.companies, [{ id, name: "ABC COMPANY" }]);
  assert.equal(cloudCopy.contracts[0].companyId, id);
  assert.equal(cloudCopy.contracts[0].received, 100000);
});
