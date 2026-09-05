#include <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

namespace {

napi_value nullValue(napi_env env) {
  napi_value value;
  napi_get_null(env, &value);
  return value;
}

bool readBounds(CFTypeRef value, CGRect* bounds) {
  return value != nullptr && CFGetTypeID(value) == AXValueGetTypeID() &&
      AXValueGetType(static_cast<AXValueRef>(value)) == kAXValueTypeCGRect &&
      AXValueGetValue(static_cast<AXValueRef>(value), kAXValueTypeCGRect, bounds) &&
      bounds->size.width > 0 && bounds->size.height > 0;
}

bool getSelectionBounds(AXUIElementRef element, CGRect* bounds) {
  AXUIElementSetMessagingTimeout(element, 0.1);
  // Native text controls expose CFRange; web content usually exposes TextMarker.
  const CFStringRef attributes[] = {
      kAXSelectedTextRangeAttribute, kAXSelectedTextMarkerRangeAttribute};
  const CFStringRef boundsAttributes[] = {
      kAXBoundsForRangeParameterizedAttribute,
      kAXBoundsForTextMarkerRangeParameterizedAttribute};

  for (int i = 0; i < 2; ++i) {
    CFTypeRef selection = nullptr;
    AXUIElementCopyAttributeValue(element, attributes[i], &selection);
    if (selection == nullptr) continue;

    bool hasSelection = false;
    if (i == 0 && CFGetTypeID(selection) == AXValueGetTypeID() &&
        AXValueGetType(static_cast<AXValueRef>(selection)) == kAXValueTypeCFRange) {
      CFRange range;
      hasSelection = AXValueGetValue(static_cast<AXValueRef>(selection),
                                    kAXValueTypeCFRange, &range) && range.length > 0;
    } else if (i == 1 && CFGetTypeID(selection) == AXTextMarkerRangeGetTypeID()) {
      CFTypeRef lengthValue = nullptr;
      int64_t length = 0;
      AXUIElementCopyParameterizedAttributeValue(
          element, kAXLengthForTextMarkerRangeParameterizedAttribute,
          selection, &lengthValue);
      if (lengthValue != nullptr) {
        if (CFGetTypeID(lengthValue) == CFNumberGetTypeID()) {
          CFNumberGetValue(static_cast<CFNumberRef>(lengthValue),
                           kCFNumberSInt64Type, &length);
        }
        CFRelease(lengthValue);
      }
      hasSelection = length > 0;
    }

    CFTypeRef boundsValue = nullptr;
    if (hasSelection) {
      AXUIElementCopyParameterizedAttributeValue(
          element, boundsAttributes[i], selection, &boundsValue);
    }
    CFRelease(selection);
    const bool success = readBounds(boundsValue, bounds);
    if (boundsValue != nullptr) CFRelease(boundsValue);
    if (success) return true;
  }
  return false;
}

AXUIElementRef copyElementAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = nullptr;
  AXUIElementCopyAttributeValue(element, attribute, &value);
  if (value == nullptr || CFGetTypeID(value) != AXUIElementGetTypeID()) {
    if (value != nullptr) CFRelease(value);
    return nullptr;
  }
  return static_cast<AXUIElementRef>(value);
}

napi_value getSelectionBounds(napi_env env, napi_callback_info info) {
  if (!AXIsProcessTrusted()) return nullValue(env);

  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide == nullptr) return nullValue(env);
  AXUIElementSetMessagingTimeout(systemWide, 0.1);

  CGRect bounds;
  AXUIElementRef focusedElement = copyElementAttribute(
      systemWide, kAXFocusedUIElementAttribute);
  CFRelease(systemWide);
  if (focusedElement == nullptr) return nullValue(env);
  const bool success = getSelectionBounds(focusedElement, &bounds);
  CFRelease(focusedElement);
  if (!success) return nullValue(env);

  napi_value result;
  napi_create_object(env, &result);
  const char* keys[] = {"x", "y", "width", "height"};
  const double values[] = {
      bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height};
  for (int i = 0; i < 4; ++i) {
    napi_value value;
    napi_create_double(env, values[i], &value);
    napi_set_named_property(env, result, keys[i], value);
  }
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor descriptor = {
      "getSelectionBounds", nullptr, getSelectionBounds, nullptr, nullptr,
      nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &descriptor);
  return exports;
}
