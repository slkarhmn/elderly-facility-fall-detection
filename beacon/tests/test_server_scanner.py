import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import scanner as beacon_scanner


async def _feed_packet(handler, payload: bytes):
    reader = asyncio.StreamReader()
    reader.feed_data(payload)
    reader.feed_eof()
    writer = MagicMock()
    writer.get_extra_info = MagicMock(return_value=("127.0.0.1", 12345))
    await handler(reader, writer)
    writer.close.assert_called_once()


class TestHandleScannerPacket:
    @pytest.mark.asyncio
    async def test_valid_packet_broadcasts_state_change(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(
                srv.handle_scanner_packet,
                b"PATIENT_01,ROOM_A,-72,0",
            )
        broadcast.assert_awaited_once()
        msg = broadcast.await_args.args[0]
        assert msg["type"] == "state_change"
        assert msg["patient_id"] == "PATIENT_01"
        assert msg["room"] == "ROOM_A"
        assert msg["rssi"] == -72
        assert msg["state_index"] == 0
        assert patient_has_room(srv, "PATIENT_01", "ROOM_A", -72)

    @pytest.mark.asyncio
    async def test_repeat_packet_same_state_is_heartbeat(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,0")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-70,0")
            calls = broadcast.await_args_list
        assert calls[0].args[0]["type"] == "state_change"
        assert calls[1].args[0]["type"] == "heartbeat"

    @pytest.mark.asyncio
    async def test_state_change_after_heartbeat(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,0")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,1")
            calls = broadcast.await_args_list
        assert calls[0].args[0]["type"] == "state_change"
        assert calls[1].args[0]["type"] == "state_change"
        assert calls[1].args[0]["state_index"] == 1

    @pytest.mark.asyncio
    async def test_fall_likely_broadcast(self, srv):
        srv.patient_registry["PATIENT_01"] = {
            "name": "Jane",
            "age": "",
            "room": "",
            "facility": "",
            "contacts": ["000"],
        }
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(
                srv.handle_scanner_packet,
                b"PATIENT_01,ROOM_A,-72,FALL_LIKELY",
            )
        broadcast.assert_awaited_once()
        msg = broadcast.await_args.args[0]
        assert msg["type"] == "fall_likely"
        assert msg["patient_id"] == "PATIENT_01"
        assert msg["room"] == "ROOM_A"
        assert msg["name"] == "Jane"

    @pytest.mark.asyncio
    async def test_malformed_packet_no_broadcast(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(srv.handle_scanner_packet, b"not,enough")
        broadcast.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_fall_state_triggers_fall_alert(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,0")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,6")
            calls = broadcast.await_args_list
        types = [c.args[0]["type"] for c in calls]
        assert "fall" in types
        fall_msgs = [c.args[0] for c in calls if c.args[0]["type"] == "fall"]
        assert fall_msgs[0]["patient_id"] == "PATIENT_01"
        assert fall_msgs[0]["room"] == "ROOM_A"

    @pytest.mark.asyncio
    async def test_fall_alert_latched_no_duplicate_broadcast(self, srv):
        with patch.object(srv, "broadcast", new_callable=AsyncMock) as broadcast:
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,0")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,6")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,0")
            await _feed_packet(srv.handle_scanner_packet, b"PATIENT_01,ROOM_A,-72,6")
            calls = broadcast.await_args_list
        fall_count = sum(1 for c in calls if c.args[0]["type"] == "fall")
        assert fall_count == 1


def patient_has_room(srv, patient_id, room, rssi):
    rooms = srv.patient_data.get(patient_id, {})
    if room not in rooms:
        return False
    stored_rssi, _t = rooms[room]
    return stored_rssi == rssi


class TestScannerToServerTcp:
    @pytest.mark.asyncio
    async def test_send_to_server_updates_server_state(self, srv):
        server = await asyncio.start_server(
            srv.handle_scanner_packet, "127.0.0.1", 0
        )
        port = server.sockets[0].getsockname()[1]
        old_ip = beacon_scanner.SERVER_IP
        old_port = beacon_scanner.SERVER_PORT
        old_room = beacon_scanner.ROOM_NAME
        try:
            beacon_scanner.SERVER_IP = "127.0.0.1"
            beacon_scanner.SERVER_PORT = port
            beacon_scanner.ROOM_NAME = "ROOM_B"
            beacon_scanner.send_to_server("PATIENT_TCP", -55, 2)
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                if "PATIENT_TCP" in srv.patient_data:
                    break
                await asyncio.sleep(0.01)
            assert patient_has_room(srv, "PATIENT_TCP", "ROOM_B", -55)
            assert srv.patient_last_state["PATIENT_TCP"] == 2
        finally:
            beacon_scanner.SERVER_IP = old_ip
            beacon_scanner.SERVER_PORT = old_port
            beacon_scanner.ROOM_NAME = old_room
            server.close()
            await server.wait_closed()


class TestScannerHelpers:
    def test_stumble_tracking_sends_fall_likely_after_threshold(self, monkeypatch):
        sent = []

        def capture_send(pid, rssi, state_index, message_override=None):
            sent.append(message_override or f"{pid},{beacon_scanner.ROOM_NAME},{rssi},{state_index}")

        monkeypatch.setattr(beacon_scanner, "send_to_server", capture_send)
        clock = {"t": 1000.0}
        monkeypatch.setattr(time, "time", lambda: clock["t"])

        beacon_scanner.handle_stumble_tracking("PATIENT_S", -1, 1)
        clock["t"] = 1000.0 + beacon_scanner.STUMBLE_ALERT_SECONDS + 1
        beacon_scanner.handle_stumble_tracking("PATIENT_S", -1, 1)

        assert len(sent) == 1
        assert sent[0].endswith(",FALL_LIKELY")

    def test_detection_callback_fall_uuid_sends_to_server(self, monkeypatch):
        sent = []

        monkeypatch.setattr(beacon_scanner, "send_to_server", lambda *a, **k: sent.append(a))

        device = MagicMock()
        device.name = "PATIENT_BLE"
        adv = MagicMock()
        adv.rssi = -40
        adv.manufacturer_data = {}
        adv.service_uuids = [beacon_scanner.FALL_UUID]

        beacon_scanner.detection_callback(device, adv)

        assert beacon_scanner.latest_patient_state["PATIENT_BLE"] == (-40, 6)
        assert len(sent) == 1
        assert sent[0][0] == "PATIENT_BLE" and sent[0][2] == 6

    def test_detection_callback_manufacturer_state(self, monkeypatch):
        monkeypatch.setattr(beacon_scanner, "send_to_server", lambda *a, **k: None)

        device = MagicMock()
        device.name = "PATIENT_MFG"
        adv = MagicMock()
        adv.rssi = -50
        adv.manufacturer_data = {0xFFFF: bytes([3])}
        adv.service_uuids = []

        beacon_scanner.detection_callback(device, adv)

        assert beacon_scanner.latest_patient_state["PATIENT_MFG"] == (-50, 3)
