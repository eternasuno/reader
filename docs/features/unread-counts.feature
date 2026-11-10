Feature: Unread counts
  As a signed-in user
  I want to see how many articles are unread
  So that I know where new content is waiting

  Background:
    Given I am signed in

  Scenario: Counts for saved pages and feeds
    Given I have 2 unread saved pages
    And feed "A" has 3 unread articles and feed "B" has 4
    When I open the library
    Then the saved-page count is 2
    And feed "A" shows 3
    And feed "B" shows 4
    And the subscription total is 7

  Scenario: Counts follow read-state changes
    When I mark a feed article as read
    Then its feed count and the subscription total each decrease by 1
    And the saved-page count is unchanged

  Scenario: Counts follow new content
    When a refresh imports new unread articles into feed "A"
    Then the count of feed "A" and the subscription total increase accordingly

  Scenario: Counts follow unsubscribing
    When I unsubscribe from feed "A"
    Then feed "A" disappears from the counts
    And the subscription total no longer includes its articles

  Scenario: Counts are private
    Given another user has unread content
    Then it is never included in my counts
