"""Allow only presentation/settlement frames while awaiting the strict startup response."""

NON_ERROR_LEVELS = ("info", "warning")
COMMAND_SOURCES = ("builtin", "skill", "extension", "custom", "mcp_prompt", "file")
REPORTED_TYPES = (
    "available_commands_update", "extension_error", "extension_ui_request", "notice", "prompt_result",
    "ready", "response", "rpc_chunk", "rpc_frame_error", "session_settled",
)


class UnexpectedFrame(Exception):
    def __init__(self, frame_type):
        self.frame_type = frame_type if frame_type in REPORTED_TYPES else "unknown"
        super().__init__("RPC_RESPONSE_CORRELATION")


def optional_string(value, key):
    return key not in value or isinstance(value[key], str)


def string_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def slash_command(value):
    return (isinstance(value, dict) and isinstance(value.get("name"), str) and value.get("source") in COMMAND_SOURCES
            and optional_string(value, "description") and ("aliases" not in value or string_list(value["aliases"]))
            and ("input" not in value or isinstance(value["input"], dict) and optional_string(value["input"], "hint"))
            and ("subcommands" not in value or isinstance(value["subcommands"], list) and all(
                isinstance(item, dict) and isinstance(item.get("name"), str) and optional_string(item, "description")
                and optional_string(item, "usage") for item in value["subcommands"])))


def passive_extension_ui(frame):
    if not isinstance(frame.get("id"), str):
        return False
    match frame.get("method"):
        case "notify":
            return isinstance(frame.get("message"), str) and frame.get("notifyType", "info") in NON_ERROR_LEVELS
        case "setStatus":
            return isinstance(frame.get("statusKey"), str) and optional_string(frame, "statusText")
        case "setWidget":
            return (isinstance(frame.get("widgetKey"), str) and ("widgetLines" not in frame or string_list(frame["widgetLines"]))
                    and frame.get("widgetPlacement", "aboveEditor") in ("aboveEditor", "belowEditor"))
        case "setTitle":
            return isinstance(frame.get("title"), str)
        case _:
            return False


def startup_notification(frame):
    match frame["type"]:
        case "session_settled":
            return len(frame) == 1
        case "available_commands_update":
            commands = frame.get("commands")
            return isinstance(commands, list) and all(slash_command(item) for item in commands)
        case "notice":
            return (frame.get("level") in NON_ERROR_LEVELS and isinstance(frame.get("message"), str)
                    and optional_string(frame, "source"))
        case "extension_ui_request":
            return passive_extension_ui(frame)
        case _:
            return False


def read_reply(next_frame, command, request_id):
    while True:
        frame = next_frame()
        if frame["type"] == "response" and frame.get("command") == command and frame.get("id") == request_id:
            return frame
        if command != "strict_start" or not startup_notification(frame):
            raise UnexpectedFrame(frame["type"])
