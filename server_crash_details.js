// Generated from src/server_crash_details.ts. Do not edit by hand.
"use strict";
function trimCrashText(value, maxLength = 4000) {
    const text = String(value == null ? "" : value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
function crashValueToString(value) {
    if (typeof value === "string")
        return trimCrashText(value);
    if (value == null)
        return String(value);
    try {
        return trimCrashText(JSON.stringify(value, (_key, nestedValue) => {
            if (typeof nestedValue === "bigint")
                return nestedValue.toString();
            if (typeof nestedValue === "function")
                return `[Function ${nestedValue.name || "anonymous"}]`;
            return nestedValue;
        }));
    }
    catch (_error) {
        return trimCrashText(String(value));
    }
}
function errorToCrashDetails(error) {
    if (error instanceof Error) {
        const maybeError = error;
        return {
            name: maybeError.name || "Error",
            message: trimCrashText(maybeError.message || ""),
            stack: trimCrashText(maybeError.stack || ""),
            code: maybeError.code ? String(maybeError.code) : "",
            cause: maybeError.cause ? crashValueToString(maybeError.cause) : "",
        };
    }
    return {
        name: typeof error,
        message: crashValueToString(error),
        stack: "",
        code: "",
    };
}
module.exports = {
    crashValueToString,
    errorToCrashDetails,
    trimCrashText,
};
