import fs from "fs";
import path from "path";
import { Database } from "bun:sqlite";

type CharacterStrokeDataEntry = {
    character: string;
    strokeSequences: string[];
};
type CharacterSuggestionsData = Record<string, string[]>;

const oldDatabasePath = path.join("data", "g6_old.sqlite");
const newDatabasePath = path.join("data", "g6_new.sqlite");
const walPath = `${newDatabasePath}-wal`;
const shmPath = `${newDatabasePath}-shm`;
const finalDatabasePath = path.join("g6.sqlite");
fs.rmSync(newDatabasePath, { force: true });
fs.copyFileSync(oldDatabasePath, newDatabasePath, fs.constants.COPYFILE_FICLONE);

// open the copied database in read-write mode to perform migrations
const db = new Database(newDatabasePath, { strict: true, readonly: false });
db.run("PRAGMA journal_mode = WAL;");

// clear TCF table
db.run("DELETE FROM G6TCF;");
db.run("VACUUM;");

// write new TCF data
const strokeData = JSON.parse(fs.readFileSync(path.join("data", "strokeData.json"), "utf-8")) as CharacterStrokeDataEntry[];
const insertTCFStmt = db.prepare("INSERT INTO G6TCF (_id, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10, Code11, Code12, Code13, Code14, Code15, Code16, Code17, Code18, Code19, Code20, Code21, Code22, Code23, Code24, Code25, Code26, Code27, Code28, Code29, Character, Frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);");
let tcfID = 0;
for (const character of strokeData) {
    const seenTruncatedSequences = new Set<string>();
    for (const strokeSequence of character.strokeSequences) {
        const codes: string[] = [];
        if (strokeSequence.length > 30) {
            console.warn(`Warning: Character "${character.character}" has a stroke sequence longer than 30 strokes. ${strokeSequence.length - 30} extra strokes will be dropped.`);
        }
        for (let i = 0; i < 30; i++) {
            codes.push(strokeSequence[i] || "");
        }
        const key = codes.join("|");
        if (seenTruncatedSequences.has(key)) { continue; }
        seenTruncatedSequences.add(key);
        const values = [tcfID++, ...codes, character.character, 0];
        insertTCFStmt.run(...values);
    }
}

// clear ADB table
db.run("DELETE FROM ADB;");
db.run("VACUUM;");

// write new ADB data
const suggestionsData = JSON.parse(fs.readFileSync(path.join("data", "suggestionsData.json"), "utf-8")) as CharacterSuggestionsData;
const insertADBStmt = db.prepare("INSERT INTO ADB (_id, Code, Word0, Word1, Word2, Word3, Word4, Word5, Word6, Word7, Word8, Word9, Word10, Word11, Word12, Word13, Word14, Word15, Word16, Word17, Word18, Word19, Word20, Word21, Word22, Word23, Word24, Word25, Word26, Word27, Word28, Word29, Word30, Word31, Word32, Word33, Word34, Word35, Word36, Word37, Word38, Word39, Word40, Word41, Word42, Word43, Word44, Word45, Word46, Word47, Word48, Word49, Word50, Word51, Word52, Word53, Word54, Word55, Word56, Word57, Word58, Word59, Word60, Word61, Word62) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);");
let adbID = 0;
for (const [code, words] of Object.entries(suggestionsData)) {
    const wordValues: string[] = [];
    if (words.length > 63) {
        console.warn(`Warning: Code "${code}" has more than 63 suggestions. ${words.length - 63} extra suggestions will be dropped.`);
    }
    for (let i = 0; i < 63; i++) {
        wordValues.push(words[i] || "");
    }
    const values = [adbID++, code, ...wordValues];
    insertADBStmt.run(...values);
}

// checkpoint and switch out of WAL
db.run("PRAGMA wal_checkpoint(TRUNCATE);");
db.run("PRAGMA journal_mode = DELETE;");

// close the database
db.close();

// remove temp WAL/SHM files if any
fs.rmSync(walPath, { force: true });
fs.rmSync(shmPath, { force: true });

// wait until the new database file is fully written
setTimeout(() => {
    // replace the old database file with the new one
    fs.rmSync(finalDatabasePath, { force: true });
    fs.renameSync(newDatabasePath, finalDatabasePath);
}, 1000);