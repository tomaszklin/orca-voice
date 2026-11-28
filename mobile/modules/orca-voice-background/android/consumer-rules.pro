# Orca Voice fork: Garmin Connect sends IQDevice/IQApp as Parcelables by class name and calls
# the SDK through AIDL, so R8 must not rename or drop the Connect IQ SDK (GarminRemote.kt).
-keep class com.garmin.** { *; }
-keep interface com.garmin.** { *; }
