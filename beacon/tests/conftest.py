import pytest

import scanner as beacon_scanner
import server as beacon_server


@pytest.fixture
def srv():
    return beacon_server


@pytest.fixture(autouse=True)
def reset_beacon_server_state():
    beacon_server.patient_data.clear()
    beacon_server.patient_last_state.clear()
    beacon_server.fall_alert_latch.clear()
    beacon_server.patient_registry.clear()
    beacon_server.connected_clients.clear()
    beacon_scanner.stumble_start.clear()
    beacon_scanner.stumble_alerted.clear()
    beacon_scanner.latest_patient_state.clear()
    yield
