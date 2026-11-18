import json
import unittest

from startup_frames import read_reply, UnexpectedFrame


class StartupFrames(unittest.TestCase):
    def test_notifications_do_not_satisfy_the_strict_start_request(self):
        reply = {"type": "response", "id": "start", "command": "strict_start", "success": True, "data": {"phase": "open"}}
        frames = iter([
            {"type": "session_settled"},
            {"type": "available_commands_update", "commands": [{"name": "help", "source": "builtin"}]},
            {"type": "notice", "level": "info", "message": "synthetic notice"},
            {"type": "extension_ui_request", "id": "extension-id", "method": "notify", "message": "synthetic warning"},
            reply,
        ])
        self.assertIs(read_reply(lambda: next(frames), "strict_start", "start"), reply)

    def test_unexpected_messages_have_only_bounded_type_labels(self):
        frames = [
            ({"type": "extension_ui_request", "id": "keep-private", "method": "confirm", "message": "keep-private"},
             "extension_ui_request"),
            ({"type": "extension_ui_request", "id": "keep-private", "method": "set_editor_text", "text": "keep-private"},
             "extension_ui_request"),
            ({"type": "notice", "level": "error", "message": "keep-private"}, "notice"),
            ({"type": "available_commands_update", "commands": {}}, "available_commands_update"),
            ({"type": "response", "id": "keep-private", "command": "strict_start", "success": True, "data": {}},
             "response"),
            ({"type": "keep-private"}, "unknown"),
        ]
        for frame, expected in frames:
            with self.subTest(expected=expected), self.assertRaises(UnexpectedFrame) as caught:
                read_reply(lambda: frame, "strict_start", "start")
            self.assertEqual(json.dumps(vars(caught.exception)), json.dumps({"frame_type": expected}))

    def test_notifications_cannot_precede_the_negotiation_response(self):
        with self.assertRaises(UnexpectedFrame):
            read_reply(lambda: {"type": "session_settled"}, "negotiate_protocol", "negotiate")
