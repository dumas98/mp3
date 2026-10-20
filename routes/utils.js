/*
 * Helpers shared by the users and tasks routes.
 */

// An expected error (bad input, missing resource). Its message is safe to show to clients.
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Every response is { message, data }
function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

// A MongoDB ObjectId as a string: exactly 24 hex characters
function isId(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

// Query string parameters

function parseJSONParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') {
        throw new ApiError(400, 'The "' + name + '" parameter must be given once, as JSON');
    }
    var value;
    try {
        value = JSON.parse(raw);
    } catch (err) {
        throw new ApiError(400, 'The "' + name + '" parameter is not valid JSON');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a JSON object');
    }
    return value;
}

function parseIntParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a non-negative integer');
    }
    return Number(raw);
}

function parseBoolParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new ApiError(400, 'The "' + name + '" parameter must be true or false');
}

// Request body fields. Mongoose would silently cast wrong types (123 -> "123", "yes" -> true),
// so the types are checked here instead.

function requiredString(body, field) {
    var value = body[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new ApiError(400, 'A ' + field + ' is required');
    }
    if (typeof value !== 'string') {
        throw new ApiError(400, 'The ' + field + ' must be a string');
    }
    return value.trim();
}

function optionalString(body, field, fallback) {
    var value = body[field];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') {
        throw new ApiError(400, 'The ' + field + ' must be a string');
    }
    return value;
}

// Accepts a date string, or milliseconds since 1970 as a number or numeric string
function requiredDate(body, field) {
    var value = body[field];
    if (value === undefined || value === null || value === '') {
        throw new ApiError(400, 'A ' + field + ' is required');
    }
    var date;
    if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value.trim()))) {
        date = new Date(Number(value));
    } else if (typeof value === 'string') {
        date = new Date(value);
    }
    if (!date || isNaN(date.getTime())) {
        throw new ApiError(400, 'The ' + field + ' must be a valid date');
    }
    return date;
}

function optionalBoolean(body, field, fallback) {
    var value = body[field];
    if (value === undefined || value === null) return fallback;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new ApiError(400, 'The ' + field + ' must be true or false');
}

// A list of ids, with duplicates removed
function optionalIdList(body, field) {
    var value = body[field];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw new ApiError(400, 'The ' + field + ' must be a list of ids');
    }
    value.forEach(function (id) {
        if (!isId(id)) {
            throw new ApiError(400, 'The ' + field + ' list contains an invalid id');
        }
    });
    return Array.from(new Set(value));
}

// Errors MongoDB/Mongoose raise because the query itself is bad (e.g. where={"_id": "abc"}),
// as opposed to the database being unreachable
function isBadQuery(err) {
    return err.name === 'CastError' || err.name === 'StrictModeError' || err.name === 'MongoServerError';
}

// GET on a collection. where/sort/select/skip/limit/count are all applied by MongoDB.
async function listQuery(Model, query, defaultLimit) {
    var where = parseJSONParam(query, 'where') || {};
    var sort = parseJSONParam(query, 'sort');
    var select = parseJSONParam(query, 'select');
    var skip = parseIntParam(query, 'skip');
    var limit = parseIntParam(query, 'limit');
    var count = parseBoolParam(query, 'count');
    // The default limit caps the documents returned, not a count; an explicit limit applies to both
    if (limit === undefined && !count) limit = defaultLimit;

    var q;
    try {
        q = count ? Model.countDocuments(where) : Model.find(where);
        if (sort && !count) q = q.sort(sort);
        if (select && !count) q = q.select(select);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
    } catch (err) {
        throw new ApiError(400, 'The query parameters are not valid');
    }
    try {
        return await q;
    } catch (err) {
        if (isBadQuery(err)) throw new ApiError(400, 'The query parameters are not valid');
        throw err;
    }
}

// GET on one resource. Only select applies; an unknown or malformed id is a 404.
async function findOne(Model, id, query, label) {
    if (!isId(id)) throw new ApiError(404, label + ' not found');
    var select = parseJSONParam(query, 'select');
    var doc;
    try {
        doc = await Model.findById(id).select(select);
    } catch (err) {
        if (isBadQuery(err)) throw new ApiError(400, 'The select parameter is not valid');
        throw err;
    }
    if (!doc) throw new ApiError(404, label + ' not found');
    return doc;
}

module.exports = {
    ApiError: ApiError,
    send: send,
    isId: isId,
    listQuery: listQuery,
    findOne: findOne,
    parseJSONParam: parseJSONParam,
    parseIntParam: parseIntParam,
    parseBoolParam: parseBoolParam,
    requiredString: requiredString,
    optionalString: optionalString,
    requiredDate: requiredDate,
    optionalBoolean: optionalBoolean,
    optionalIdList: optionalIdList
};
