package com.runway.backend.domain.user.dto.request;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.node.DecimalNode;

/** Preserves decimal input without double rounding; absent and explicit null stay distinct. */
public final class ExactDecimalNodeDeserializer extends ValueDeserializer<JsonNode> {
    @Override
    public JsonNode deserialize(JsonParser parser, DeserializationContext context) {
        if (parser.currentToken() == JsonToken.VALUE_NUMBER_INT
                || parser.currentToken() == JsonToken.VALUE_NUMBER_FLOAT) {
            return DecimalNode.valueOf(parser.getDecimalValue());
        }
        return context.readTree(parser);
    }

    @Override
    public JsonNode getNullValue(DeserializationContext context) {
        return context.getNodeFactory().nullNode();
    }

    @Override
    public Object getAbsentValue(DeserializationContext context) {
        return null;
    }
}
