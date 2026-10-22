import {describe,expect,it} from "vitest";
import {markExistingDuplicates,parseCsvText,summarizeCsv,validateCsvRows} from "@/lib/csv";
describe("CSV parser",()=>{
 it("supports quoted commas, escaped quotes and multiline fields",()=>{const result=parseCsvText('name,email,phone\n"Doe, Jane",jane@example.com,1234567\n"Line 1\nLine 2",a@example.com,7654321\n"She said ""hi""",b@example.com,7654321');expect(result.error).toBe("");expect(result.records[0].name).toBe("Doe, Jane");expect(result.records[1].name).toContain("Line 2");expect(result.records[2].name).toBe('She said "hi"')});
 it("keeps duplicate warnings separate from validation errors",()=>{const rows=markExistingDuplicates(validateCsvRows([{name:"A",email:"A@EXAMPLE.COM",phone:"+1 555 123 4567"},{name:"B",email:"a@example.com",phone:"15551234567"}]),[{phone:"15551234567"}]);expect(rows.every(row=>row.errors.length===0)).toBe(true);expect(summarizeCsv(rows)).toMatchObject({valid:2,invalid:0,duplicateEmails:1,duplicatePhones:3,existingDuplicates:2})});
 it("rejects unterminated quoted fields",()=>{expect(parseCsvText('name,email\n"broken,a@example.com').error).toMatch(/unterminated/i)});
});
