# 0024 Transport: routes, stops and seats for a term

Date: 2026-10-31 · Status: Accepted

## Context

The brief asks for transport with routes and seat allocation (M4.5). A family buys a seat on a school bus for a term, boarding at a chosen stop; the driver needs, each day the bus runs, who gets on where. Seats are limited, so two families must never get the same last seat.

## Decision

- **A route for one term is an offering of kind `transport`**, priced per term. Its details are a `scheduling.transport_route` row (vehicle, weekdays it runs) and its ordered **stops** (`scheduling.transport_stop`: name, pick-up and drop-off time, school local time).
- **The term is one session of the offering**, from the term's first day to its last, with the bus's seats as its capacity (a new "term" calendar on the set-up page). A seat is then an ordinary booking of that session, bought through the normal checkout, so the existing capacity guarantee applies unchanged: the session row is locked and its counter checked in the same transaction as the order, and a request for a full route is refused (`PY002`). No new locking was needed.
- **The child's stop is on the booking** (`scheduling.booking.transport_stop_id`). A trigger requires it for a transport booking and refuses it elsewhere, and the stop must be an active stop of that route (`PY018`); the basket must name the stop.
- **Seats are bought before the term starts**: booking and cancelling close when the term begins, as for clubs.
- **The driver's list** (`GET /school-life/transport?date=`) shows, for each route that runs that day at the viewer's schools (`bookings.read`), the stops in order with their times and the paid seats boarding at each, with class. Drivers have no accounts; staff print or share the list.

## Consequences

- A route used in several terms is one offering per term (each with its own price and seats); its stops are copied when the next term is set up.
- Changing a child's stop after booking is a staff task outside the platform for now; return journeys and different stops for the morning and afternoon are not modelled separately (a stop has both times).
- Bus-company contracts, GPS tracking and parent notifications of delays are integrations for later (M7).
