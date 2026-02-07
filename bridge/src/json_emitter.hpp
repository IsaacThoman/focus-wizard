/**
 * json_emitter.hpp — Thread-safe JSON line emitter to stdout
 *
 * The protocol is "JSON Lines" (aka NDJSON): one JSON object per line,
 * terminated by \n. The Electron main process reads these line-by-line.
 *
 * Message types:
 *   { "type": "metrics",    "data": { ... } }
 *   { "type": "edge",       "data": { ... } }
 *   { "type": "focus",      "data": { ... } }
 *   { "type": "status",     "data": { "status": "..." } }
 *   { "type": "error",      "data": { "message": "..." } }
 *   { "type": "ready",      "data": {} }
 */

#pragma once

#include <string>
#include <mutex>
#include <iostream>
#include <sstream>

namespace focus_wizard {

class JsonEmitter {
public:
    /**
     * Emit a JSON line to stdout.
     * Thread-safe: multiple SmartSpectra callbacks may fire concurrently.
     */
    void emit(const std::string& type, const std::string& json_data);

    /**
     * Convenience: emit a simple status message.
     */
    void emit_status(const std::string& status_text);

    /**
     * Convenience: emit an error message.
     */
    void emit_error(const std::string& error_text);

    /**
     * Convenience: emit a ready signal.
     */
    void emit_ready();

private:
    std::mutex write_mutex_;

    /**
     * Escape a string for safe JSON embedding.
     */
    static std::string escape_json_string(const std::string& input);
};

} // namespace focus_wizard
