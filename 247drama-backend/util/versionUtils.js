const GlobalLanguageVersion = require("../models/globalLanguageVersion.model");

exports.createVersionIfNeeded = async (changeLogs) => {
    const latest = await GlobalLanguageVersion
        .findOne()
        .sort({
            "version.major": -1,
            "version.minor": -1,
            "version.patch": -1
        });

    if (!changeLogs || changeLogs.length === 0) {
        if (!latest) return "1.0.0";

        return `${latest.version.major}.${latest.version.minor}.${latest.version.patch}`;
    }

    let major = 1, minor = 0, patch = 0;

    if (latest) {
        major = latest.version.major;
        minor = latest.version.minor;
        patch = latest.version.patch;
    }

    // Decide bump type
    let bumpType = "patch";

    for (const change of changeLogs) {
        if (change.type === "ADD_LANGUAGE" || change.type === "ADD_KEY") {
            bumpType = "minor";
        }
        if (change.type === "REMOVE_KEY") {
            bumpType = "major";
            break;
        }
        if (change.type === "UPDATE_KEY") {
            bumpType = "patch";
            break;
        }
    }

    if (bumpType === "major") {
        major += 1;
        minor = 0;
        patch = 0;
    } else if (bumpType === "minor") {
        minor += 1;
        patch = 0;
    } else if (bumpType === "patch") {
        patch += 1;
    }

    await GlobalLanguageVersion.create({
        version: {
            major,
            minor,
            patch
        },
        changes: changeLogs
    });

    return `${major}.${minor}.${patch}`;
};

exports.getLatestVersion = async () => {
    let lastVersion = await GlobalLanguageVersion
        .findOne()
        .sort({
            "version.major": -1,
            "version.minor": -1,
            "version.patch": -1
        });

    if (!lastVersion) {
        lastVersion = await GlobalLanguageVersion.create({
            version: { major: 1, minor: 0, patch: 0 },
            changes: []
        });

        return "1.0.0";
    }

    const { major, minor, patch } = lastVersion.version;
    return `${major}.${minor}.${patch}`;
};