Feature: Account
  As a visitor
  I want to register and sign in with email and password
  So that my reading library is private to me

  Scenario: Register a new account
    Given I am not signed in
    When I register with a new email and a password of 8 to 128 characters
    Then my account is created
    And I am not signed in automatically
    And I am taken to the login page

  Scenario: Reject a password that is too short
    Given I am not signed in
    When I register with a password shorter than 8 characters
    Then registration is rejected with an error
    And no account is created

  Scenario: Reject an email that is already registered
    Given an account exists for "reader@example.com"
    When I register with "reader@example.com"
    Then registration is rejected with an error

  Scenario: Sign in with valid credentials
    Given an account exists for "reader@example.com"
    When I sign in with the correct email and password
    Then I see my library

  Scenario: Reject invalid credentials
    Given an account exists for "reader@example.com"
    When I sign in with a wrong password
    Then sign-in is rejected with an error
    And I stay on the login page

  Scenario Outline: Protected pages require a session
    Given I am not signed in
    When I open "<page>"
    Then I am redirected to the login page

    Examples:
      | page     |
      | /        |
      | /rss     |
      | /settings |

  Scenario: Protected API requires a session
    Given I am not signed in
    When I call any "/api/library" endpoint
    Then the request is rejected as unauthenticated

  Scenario: Identity comes only from the session
    Given I am signed in as user A
    When I send a request that names user B as the owner
    Then the request is still handled as user A

  Scenario: Sign out
    Given I am signed in
    When I choose to sign out
    Then my session ends
    And I am taken to the login page

  Scenario: Change password
    Given I am signed in
    When I enter my current password and a valid new password with matching confirmation
    Then my password is changed
    And I can sign in with the new password

  Scenario: Change password with a wrong current password
    Given I am signed in
    When I enter an incorrect current password
    Then the password is not changed
    And I see an error
