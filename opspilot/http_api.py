"""Transport-neutral API validation, used by both local and deployment servers."""
from dataclasses import replace
import uuid
from .service import analyze_request


def handle_analysis(payload, settings):
    if not isinstance(payload, dict) or not isinstance(payload.get('question'), str) or not isinstance(payload.get('rows'), list):
        raise ValueError('Invalid request')
    if not 1 <= len(payload['question']) <= 500 or not 1 <= len(payload['rows']) <= 20000:
        raise ValueError('Input limit exceeded')
    channel = payload.get('channel')
    if channel is not None and (not isinstance(channel, str) or len(channel) > 80):
        raise ValueError('Invalid channel')
    for key in ('dataset', 'range'):
        if payload.get(key) is not None and not isinstance(payload[key], dict):
            raise ValueError('Invalid data contract')
    if not isinstance(payload.get('use_model', False), bool):
        raise ValueError('Invalid model consent')
    if not payload.get('use_model', False):
        settings = replace(settings, api_key='')
    result = analyze_request({k: payload.get(k) for k in ('rows', 'question', 'channel', 'dataset', 'range')}, settings)
    result['request_id'] = str(uuid.uuid4())
    return result
