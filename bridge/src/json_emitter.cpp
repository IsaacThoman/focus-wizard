/**
 * json_emitter.cpp — Implementation
 */

#include "json_emitter.hpp"

namespace focus_wizard {

void JsonEmitter::emit(const std::string& type, const std::string& json_data) {
    std::lock_guard<std::mutex> lock(write_mutex_);
    // Write a complete JSON line atomically
    std::cout << "{\"type\":\"" << type << "\",\"data\":" << json_data << "}" << std::endl;
    // std::endl flushes, which is critical for the pipe to Electron
}

void JsonEmitter::emit_status(const std::string& status_text) {
    std::string data = "{\"status\":\"" + escape_json_string(status_text) + "\"}";
    emit("status", data);
}

void JsonEmitter::emit_error(const std::string& error_text) {
    std::string data = "{\"message\":\"" + escape_json_string(error_text) + "\"}";
    emit("error", data);
}

void JsonEmitter::emit_ready() {
    emit("ready", "{}");
}

std::string JsonEmitter::escape_json_string(const std::string& input) {
    std::ostringstream ss;
    for (char c : input) {
        switch (c) {
            case '"':  ss << "\\\""; break;
            case '\\': ss << "\\\\"; break;
            case '\b': ss << "\\b";  break;
            case '\f': ss << "\\f";  break;
            case '\n': ss << "\\n";  break;
            case '\r': ss << "\\r";  break;
            case '\t': ss << "\\t";  break;
            default:
                if ('\x00' <= c && c <= '\x1f') {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    ss << buf;
                } else {
                    ss << c;
                }
        }
    }
    return ss.str();
}

} // namespace focus_wizard
